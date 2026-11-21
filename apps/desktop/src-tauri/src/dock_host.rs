//! Hosts the dock: its window, its commands and events, and the icons it loads. Logic lives in the `dotdock-dock`
//! crate (the service with the catalogue and running windows, and the host that places the window, reserves the
//! screen strip, draws the glass and hides the taskbar); this wires it to Tauri and to the restore guard.
//!
//! The dock window is a transparent sheet over the primary monitor, hidden until the UI has asked for its first
//! snapshot, click-through except where the UI says it draws something (`dock_set_regions`).

use crate::lifecycle;
use dotdock_dock::backdrop;
use dotdock_dock::host::{DockHost, Hooks};
use dotdock_dock::icons::{self, webview_url};
use dotdock_dock::protocol::{
    Category, CategoryId, CommandResult, DockApp, DockEvent, DockSettings, DockSnapshot, DockWindow, PreviewArgs, Rect,
};
use dotdock_dock::service::{DockService, ServiceConfig};
use dotdock_shell::modules::{Lifecycle, Modules};
use dotdock_shell::{boot_log, dock_guard};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;
use tauri::http::{Request, Response, StatusCode};
use tauri::{
    AppHandle, Emitter, Manager, State, UriSchemeContext, UriSchemeResponder, WebviewUrl, WebviewWindowBuilder,
};

pub const DOCK_LABEL: &str = "dock";
/// The event that tells the dock whether its glass can be drawn (`DockBackdrop` in `protocol.ts`).
const EVENT_BACKDROP: &str = "dock://backdrop";
/// Folder of the dock's own files (`dock.json`, the catalogue cache) inside the app data folder.
const DATA_FOLDER: &str = "dock";
/// How long a request for an icon waits for an extraction in progress. A cold first run takes up to 20 s for a long
/// app list; a late icon beats a broken image.
const ICON_WAIT: Duration = Duration::from_secs(25);
/// Icons are named by a hash of what they were made from, so a cached answer never goes stale.
const ICON_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";

/// Managed state: the backend and the host. Present once `start` succeeded.
pub struct DockState {
    service: DockService,
    host: DockHost,
    parts: Mutex<Parts>,
}

/// Which of the environment's two dock parts run (`ModuleId::Dock`, `ModuleId::Taskbar`).
#[derive(Clone, Copy, Default)]
struct Parts {
    dock: bool,
    taskbar: bool,
}

impl DockState {
    fn parts(&self) -> std::sync::MutexGuard<'_, Parts> {
        self.parts.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The stored settings with the parts deciding whether the dock shows and whether it replaces the taskbar.
    fn effective(&self, settings: DockSettings) -> DockSettings {
        let parts = *self.parts();
        settings.governed(parts.dock, parts.taskbar)
    }

    fn set_parts(&self, change: impl FnOnce(&mut Parts)) {
        change(&mut self.parts());
        self.host.settings(self.settings());
    }

    /// The settings the dock window and Settings read: the user's own, with the dock's two switches as the parts
    /// set them.
    pub fn settings(&self) -> DockSettings {
        self.effective(self.service.snapshot().settings)
    }

    /// Stores settings from Settings or the dock window. The two switches the parts own are kept as stored.
    pub fn set_settings(&self, settings: DockSettings) -> CommandResult {
        let stored = self.service.snapshot().settings;
        self.service.set_settings(DockSettings {
            enabled: stored.enabled,
            replace_taskbar: stored.replace_taskbar,
            ..settings
        })
    }
}

/// What the host asks of the application.
struct AppHooks(AppHandle);

impl Hooks for AppHooks {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        let _ = self.0.emit_to(DOCK_LABEL, event, payload);
    }

    fn log(&self, line: &str) {
        boot_log::record(&format!("dock: {line}"));
    }

    fn set_taskbar_hidden(&self, hidden: bool) -> Result<(), String> {
        if hidden {
            dock_guard::hide_for_dock().map_err(|e| e.to_string())
        } else {
            dock_guard::restore_after_dock();
            Ok(())
        }
    }

    fn taskbar_refused(&self, reason: &str) {
        // The host has already put the taskbar back; the next start of the dotDock theme tries again.
        boot_log::record(&format!("dock: the taskbar could not be hidden, the Windows taskbar stays: {reason}"));
    }

    fn wallpaper_changed(&self) {
        crate::wallpaper_host::announce(&self.0);
    }

    fn quit(&self) {
        boot_log::record("dock: quit shortcut pressed");
        // The exit handler stops the host and restores the taskbar before the process ends.
        self.0.exit(0);
    }
}

/// The "Restore Windows desktop" action gave Windows its desktop back, taskbar included: the dotDock theme goes off,
/// so the dock does not take the taskbar's place again. Switching the theme on brings everything back. Runs on a
/// thread of its own: stopping the parts waits for their windows, which the main thread must be free to close.
pub fn taskbar_released(app: &AppHandle) {
    let app = app.clone();
    let spawned = std::thread::Builder::new().name("dock-theme-off".into()).spawn(move || {
        if let Err(error) = app.state::<Modules>().set_environment(false) {
            boot_log::record(&format!("dock: the theme could not go off after the restore: {error}"));
        }
    });
    if let Err(error) = spawned {
        boot_log::record(&format!("dock: the theme could not go off after the restore: {error}"));
    }
}

/// Starts the dock service and the host, without a window: the dock part builds it (`DockPart`). Without a
/// catalogue folder or if the service cannot start, this build has no dock and no taskbar replacement (logged).
pub fn start(app: &AppHandle) -> tauri::Result<()> {
    let (Some(data), Some(icon_dir)) = (dotdock_shell::app_data_dir(), icons::default_cache_dir()) else {
        boot_log::record("dock: no app data folder, not started");
        return Ok(());
    };
    let (service, events) = match DockService::start(ServiceConfig { data_dir: data.join(DATA_FOLDER), icon_dir }) {
        Ok(started) => started,
        Err(error) => {
            boot_log::record(&format!("dock: service failed: {error}"));
            return Ok(());
        }
    };
    boot_log::mark("dock-service");
    // Nothing shows or hides until a part runs.
    let settings = service.snapshot().settings.governed(false, false);
    let host = match DockHost::start(Arc::new(AppHooks(app.clone())), settings) {
        Ok(host) => host,
        Err(error) => {
            boot_log::record(&format!("dock: host failed: {error}"));
            return Ok(());
        }
    };
    app.manage(DockState { service, host, parts: Mutex::new(Parts::default()) });
    let watcher = app.clone();
    std::thread::Builder::new().name("dock-backdrop".into()).spawn(move || watch_backdrop(&watcher))?;
    let forwarder = app.clone();
    std::thread::Builder::new().name("dock-events".into()).spawn(move || {
        for event in events {
            forward(&forwarder, event);
        }
    })?;
    Ok(())
}

/// Sends the backdrop whenever transparency or battery saver changes (see `backdrop`). The first reading goes out
/// with the window's first snapshot, in `dock_ready`.
fn watch_backdrop(app: &AppHandle) {
    let mut last = backdrop::read();
    loop {
        std::thread::sleep(backdrop::CHECK_EVERY);
        let now = backdrop::read();
        if now != last {
            let _ = app.emit_to(DOCK_LABEL, EVENT_BACKDROP, now);
            last = now;
        }
    }
}

/// Stops the host (removing the reserved strip and the glass) at exit. The taskbar is restored by the caller's guard.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<DockState>() {
        state.host.shutdown();
    }
}

/// Builds the dock window if there is none and hands it to the host.
fn ensure_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(DOCK_LABEL).is_some() {
        return Ok(());
    }
    let built = WebviewWindowBuilder::new(app, DOCK_LABEL, WebviewUrl::App("dock.html".into()))
        .title("dotDock")
        .visible(false)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .always_on_top(true)
        .build();
    built.map_err(|e| e.to_string()).and_then(|window| {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let state = app.try_state::<DockState>().ok_or("the dock's backend is not running")?;
        state.host.attach(hwnd.0 as isize).map_err(|e| e.to_string())
    })
}

/// The dock part: its window, shown where the plan says. Stopping hides it, gives back the reserved strip and
/// destroys the window.
pub struct DockPart(AppHandle);

impl DockPart {
    pub fn new(app: AppHandle) -> Self {
        Self(app)
    }
}

impl Lifecycle for DockPart {
    fn start(&mut self) -> Result<(), String> {
        let state = self.0.try_state::<DockState>().ok_or("The dock's backend did not start.")?;
        if let Err(error) = ensure_window(&self.0) {
            boot_log::record(&format!("dock: window failed: {error}"));
            state.host.detach();
            lifecycle::destroy_window(&self.0, DOCK_LABEL);
            return Err(format!("The dock window could not be built: {error}"));
        }
        state.set_parts(|parts| parts.dock = true);
        Ok(())
    }

    fn stop(&mut self) {
        let Some(state) = self.0.try_state::<DockState>() else { return };
        state.set_parts(|parts| parts.dock = false);
        state.host.detach();
        lifecycle::destroy_window(&self.0, DOCK_LABEL);
    }
}

/// The taskbar part: the dock takes the Windows taskbar's place through the restore guard (`dock_guard`, D0). The
/// module manager restores the taskbar after every stop and every failed start, whatever the host did.
pub struct TaskbarPart(AppHandle);

impl TaskbarPart {
    pub fn new(app: AppHandle) -> Self {
        Self(app)
    }
}

impl Lifecycle for TaskbarPart {
    fn start(&mut self) -> Result<(), String> {
        let state = self.0.try_state::<DockState>().ok_or("The dock's backend did not start.")?;
        state.set_parts(|parts| parts.taskbar = true);
        Ok(())
    }

    fn stop(&mut self) {
        if let Some(state) = self.0.try_state::<DockState>() {
            state.set_parts(|parts| parts.taskbar = false);
        }
    }
}

/// What the dock window loads for an icon; the backend names them `dock-icon://<hash>.png`.
fn for_window(app: &mut DockApp) {
    app.icon = webview_url(&app.icon);
}

fn window_for_window(window: &mut DockWindow) {
    window.icon = webview_url(&window.icon);
}

/// Passes one backend event to the host and to the dock window.
fn forward(app: &AppHandle, event: DockEvent) {
    let Some(state) = app.try_state::<DockState>() else { return };
    let event = match event {
        DockEvent::Apps(mut apps) => {
            apps.iter_mut().for_each(for_window);
            DockEvent::Apps(apps)
        }
        DockEvent::Windows(mut windows) => {
            windows.iter_mut().for_each(window_for_window);
            DockEvent::Windows(windows)
        }
        DockEvent::Settings(settings) => {
            let settings = state.effective(settings);
            state.host.settings(settings.clone());
            DockEvent::Settings(settings)
        }
        DockEvent::Frozen(frozen) => {
            state.host.frozen(frozen);
            DockEvent::Frozen(frozen)
        }
    };
    let _ = app.emit_to(DOCK_LABEL, event.name(), event.payload());
}

/// `dock-icon://<hash>.png`, served from the icon cache; reached by the window as `http://dock-icon.localhost/...`.
pub fn serve_icon(context: UriSchemeContext<'_, tauri::Wry>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = context.app_handle().clone();
    let url = icons::url_from_request_path(request.uri().path());
    // Waiting for an extraction blocks, so never on the thread that draws the windows.
    tauri::async_runtime::spawn_blocking(move || responder.respond(icon_response(&app, &url)));
}

fn icon_response(app: &AppHandle, url: &str) -> Response<Vec<u8>> {
    let bytes = app
        .try_state::<DockState>()
        .and_then(|state| state.service.icon_file(url, ICON_WAIT))
        .and_then(|path| std::fs::read(path).ok());
    let builder = Response::builder();
    match bytes {
        Some(bytes) => builder
            .status(StatusCode::OK)
            .header("Content-Type", "image/png")
            .header("Cache-Control", ICON_CACHE_CONTROL)
            .body(bytes),
        None => builder.status(StatusCode::NOT_FOUND).body(Vec::new()),
    }
    .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// The first call of the dock window: everything it needs for its first frame. The window is shown after it.
#[tauri::command(async)]
pub fn dock_ready(app: AppHandle, state: State<'_, DockState>) -> DockSnapshot {
    boot_log::mark("dock-ui-ready");
    let mut snapshot = state.service.snapshot();
    snapshot.settings = state.effective(snapshot.settings);
    snapshot.apps.iter_mut().for_each(for_window);
    snapshot.windows.iter_mut().for_each(window_for_window);
    state.host.ui_ready();
    // The window listens before it asks, so it hears the current reasons to be frozen right after the snapshot.
    let frozen = state.service.frozen();
    let _ = app.emit_to(DOCK_LABEL, dotdock_dock::protocol::EVENT_FROZEN, frozen);
    let _ = app.emit_to(DOCK_LABEL, EVENT_BACKDROP, backdrop::read());
    snapshot
}

#[tauri::command(async)]
pub fn dock_launch(app_id: String, state: State<'_, DockState>) -> CommandResult {
    state.service.launch(&app_id)
}

#[tauri::command(async)]
pub fn dock_activate(hwnd: String, state: State<'_, DockState>) -> CommandResult {
    state.service.activate(&hwnd)
}

#[tauri::command(async)]
pub fn dock_close_window(hwnd: String, state: State<'_, DockState>) -> CommandResult {
    state.service.close_window(&hwnd)
}

#[tauri::command(async)]
pub fn dock_set_category(app_id: String, category: CategoryId, state: State<'_, DockState>) -> CommandResult {
    state.service.set_category(&app_id, category)
}

#[tauri::command(async)]
pub fn dock_save_categories(categories: Vec<Category>, state: State<'_, DockState>) -> CommandResult {
    state.service.save_categories(categories)
}

#[tauri::command(async)]
pub fn dock_set_settings(settings: DockSettings, state: State<'_, DockState>) -> CommandResult {
    state.set_settings(settings)
}

#[tauri::command]
pub fn dock_set_regions(rects: Vec<Rect>, state: State<'_, DockState>) {
    state.host.set_regions(rects);
}

#[tauri::command(async)]
pub fn dock_preview(hwnds: Vec<String>, anchor: Option<Rect>, state: State<'_, DockState>) {
    let Some(metrics) = state.host.metrics() else { return };
    state.service.preview(metrics.window, metrics.scale, metrics.width_px, &PreviewArgs { hwnds, anchor });
}

#[tauri::command(async)]
pub fn dock_set_focus(active: bool, state: State<'_, DockState>) {
    state.host.set_focus(active);
}

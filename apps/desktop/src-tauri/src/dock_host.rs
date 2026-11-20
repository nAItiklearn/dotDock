//! Hosts the dock: its window, its commands and events, and the icons it loads. Logic lives in the `dotdock-dock`
//! crate (the service with the catalogue and running windows, and the host that places the window, reserves the
//! screen strip, draws the glass and hides the taskbar); this wires it to Tauri and to the restore guard.
//!
//! The dock window is a transparent sheet over the primary monitor, hidden until the UI has asked for its first
//! snapshot, click-through except where the UI says it draws something (`dock_set_regions`).

use dotdock_dock::glass::Shape;
use dotdock_dock::host::{DockHost, GlassRequest, Hooks};
use dotdock_dock::icons::{self, webview_url};
use dotdock_dock::protocol::{
    Category, CategoryId, CommandResult, DockApp, DockEvent, DockSettings, DockSnapshot, DockWindow, PreviewArgs, Rect,
};
use dotdock_dock::service::{DockService, ServiceConfig};
use dotdock_shell::{boot_log, dock_guard};
use std::sync::Arc;
use std::time::Duration;
use tauri::http::{Request, Response, StatusCode};
use tauri::{
    AppHandle, Emitter, Manager, State, UriSchemeContext, UriSchemeResponder, WebviewUrl, WebviewWindowBuilder,
};

pub const DOCK_LABEL: &str = "dock";
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

    fn taskbar_refused(&self, _reason: &str) {
        replace_taskbar_off(&self.0);
    }
}

/// Turns "replace the taskbar" off in the stored settings; the change comes back as a settings event, so the dock
/// window and the Settings page both see it.
fn replace_taskbar_off(app: &AppHandle) {
    let Some(state) = app.try_state::<DockState>() else { return };
    let mut settings = state.service.snapshot().settings;
    if settings.replace_taskbar {
        settings.replace_taskbar = false;
        let _ = state.service.set_settings(settings);
    }
}

/// The "Restore Windows desktop" action put the taskbar back by itself: the dock must stop wanting it hidden, or the
/// next change of settings would hide it again.
pub fn taskbar_released(app: &AppHandle) {
    replace_taskbar_off(app);
}

/// Starts the dock service and the host, and builds the window if the dock is enabled. Without a catalogue folder
/// or if the service cannot start, there is simply no dock (logged).
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
    let settings = service.snapshot().settings;
    let host = match DockHost::start(Arc::new(AppHooks(app.clone())), settings.clone()) {
        Ok(host) => host,
        Err(error) => {
            boot_log::record(&format!("dock: host failed: {error}"));
            return Ok(());
        }
    };
    app.manage(DockState { service, host });
    if settings.enabled {
        ensure_window(app);
    }
    let forwarder = app.clone();
    std::thread::Builder::new().name("dock-events".into()).spawn(move || {
        for event in events {
            forward(&forwarder, event);
        }
    })?;
    Ok(())
}

/// Stops the host (removing the reserved strip and the glass) at exit. The taskbar is restored by the caller's guard.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<DockState>() {
        state.host.shutdown();
    }
}

/// Builds the dock window if there is none and hands it to the host.
fn ensure_window(app: &AppHandle) {
    if app.get_webview_window(DOCK_LABEL).is_some() {
        return;
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
    let attached = built.map_err(|e| e.to_string()).and_then(|window| {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let state = app.try_state::<DockState>().ok_or("no dock state")?;
        state.host.attach(hwnd.0 as isize).map_err(|e| e.to_string())
    });
    if let Err(error) = attached {
        boot_log::record(&format!("dock: window failed: {error}"));
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
            if settings.enabled {
                ensure_window(app);
            }
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
    let mut snapshot = state.service.snapshot();
    snapshot.apps.iter_mut().for_each(for_window);
    snapshot.windows.iter_mut().for_each(window_for_window);
    state.host.ui_ready();
    // The window listens before it asks, so it hears the current reasons to be frozen right after the snapshot.
    let frozen = state.service.frozen();
    let _ = app.emit_to(DOCK_LABEL, dotdock_dock::protocol::EVENT_FROZEN, frozen);
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
    state.service.set_settings(settings)
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

#[tauri::command]
pub fn dock_set_glass(shapes: Vec<Shape>, dark: bool, state: State<'_, DockState>) {
    state.host.set_glass(GlassRequest { shapes, dark });
}

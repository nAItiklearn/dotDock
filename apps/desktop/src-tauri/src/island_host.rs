//! Hosts the Agent Island window: a floating, never-focused, click-through-until-hovered
//! pill at the top centre. Logic lives in the `dotdock-island` crate; this only wires it up.
//! See docs/ISLAND_INTEGRATION.md.

use dotdock_island::engine::{Alert, Snapshot};
use dotdock_island::paths::ClaudeDirs;
use dotdock_island::pointer::{self, PointerEvent, Poller, Regions, Target};
use dotdock_island::service::{Host, IslandService, NotificationCopy, ServiceConfig};
use dotdock_island::settings::IslandSettings;
use std::sync::{Arc, Mutex, PoisonError};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, GetWindowRect, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST, SWP_NOACTIVATE,
    SWP_NOSIZE, USER_DEFAULT_SCREEN_DPI, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    WS_EX_TRANSPARENT,
};

pub const ISLAND_LABEL: &str = "island";
/// Matches WINDOW_SIZE in src/island/protocol.ts.
const WINDOW_SIZE: (f64, f64) = (520.0, 240.0);

struct TauriHost(AppHandle);

impl Host for TauriHost {
    fn snapshot(&self, snapshot: Snapshot) {
        let _ = self.0.emit_to(ISLAND_LABEL, "island://snapshot", snapshot);
    }
    fn settings(&self, settings: IslandSettings) {
        let _ = self.0.emit_to(ISLAND_LABEL, "island://settings", settings);
    }
    // The island itself (lingering, clickable) plus its chime is the alert; system toasts are
    // deferred (D-014) because a Windows toast cannot return the user to the terminal.
    fn notify(&self, copy: NotificationCopy, _alert: Alert) {
        dotdock_shell::boot_log::record(&format!("island alert: {}: {}", copy.title, copy.body));
    }
}

/// Managed state: the service, UI-reported regions, the follow setting and the pointer thread.
pub struct IslandState {
    service: IslandService,
    regions: Arc<Mutex<Regions>>,
    follow: Arc<Mutex<bool>>,
    _poller: Poller,
}

#[derive(Clone, Copy)]
struct Raw(isize);
// SAFETY: an HWND is a process-global identifier usable from any thread.
unsafe impl Send for Raw {}

fn hwnd(raw: Raw) -> HWND {
    HWND(raw.0 as *mut _)
}

/// Window origin (physical px) and scale, read from Win32 so no UI-thread round trip is needed.
fn geometry(h: HWND) -> Option<((i32, i32), f64)> {
    let mut rect = RECT::default();
    // SAFETY: queries on our own window.
    let dpi = unsafe {
        GetWindowRect(h, &mut rect).ok()?;
        GetDpiForWindow(h)
    };
    (dpi != 0).then(|| ((rect.left, rect.top), f64::from(dpi) / f64::from(USER_DEFAULT_SCREEN_DPI)))
}

fn set_click_through(h: HWND, through: bool) {
    let wanted = (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0 | WS_EX_LAYERED.0) as isize;
    // SAFETY: style bits on our own window.
    unsafe {
        let ex = (GetWindowLongPtrW(h, GWL_EXSTYLE) | wanted) & !(WS_EX_APPWINDOW.0 as isize);
        let ex = if through { ex | WS_EX_TRANSPARENT.0 as isize } else { ex & !(WS_EX_TRANSPARENT.0 as isize) };
        SetWindowLongPtrW(h, GWL_EXSTYLE, ex);
    }
}

/// Top centre of a monitor rectangle, keeping the window's current size.
fn move_to_top_centre(h: HWND, monitor: pointer::Rect) {
    let mut rect = RECT::default();
    // SAFETY: rect query and move of our own window, without activating it.
    unsafe {
        if GetWindowRect(h, &mut rect).is_err() {
            return;
        }
        let w = rect.right - rect.left;
        let _ = SetWindowPos(
            h,
            Some(HWND_TOPMOST),
            monitor.x + (monitor.w - w) / 2,
            monitor.y,
            0,
            0,
            SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

/// Creates the island window and starts the session service. Without a Claude configuration
/// folder, or if the service cannot start, the island simply does not appear (logged).
pub fn start(app: &AppHandle) -> tauri::Result<()> {
    let Some(dirs) = ClaudeDirs::from_env() else {
        dotdock_shell::boot_log::record("island: no Claude folder, not started");
        return Ok(());
    };
    let window = WebviewWindowBuilder::new(app, ISLAND_LABEL, WebviewUrl::App("island.html".into()))
        .title("Agent Island")
        .inner_size(WINDOW_SIZE.0, WINDOW_SIZE.1)
        .visible(false)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .always_on_top(true)
        .build()?;
    let raw = Raw(window.hwnd()?.0 as isize);
    set_click_through(hwnd(raw), true);
    if let Some(m) = pointer::monitor_at((0, 0)) {
        move_to_top_centre(hwnd(raw), m);
    }

    let data_dir = dotdock_shell::app_data_dir().ok_or(tauri::Error::WindowNotFound)?;
    let hook_source = std::env::current_exe()?.with_file_name("dotdock-island-hook.exe");
    let service = match IslandService::start(ServiceConfig { dirs, data_dir, hook_source }, TauriHost(app.clone())) {
        Ok(s) => s,
        Err(err) => {
            dotdock_shell::boot_log::record(&format!("island: service failed: {err}"));
            let _ = window.destroy();
            return Ok(());
        }
    };

    let regions = Arc::new(Mutex::new(Regions::default()));
    let follow = Arc::new(Mutex::new(service.settings().follow_cursor));
    let poll_regions = regions.clone();
    let poll_follow = follow.clone();
    let events_app = app.clone();
    let poller = pointer::spawn_poller(
        move || {
            let (origin, scale) = geometry(hwnd(raw))?;
            let screen = poll_regions.lock().unwrap_or_else(PoisonError::into_inner).to_screen(origin, scale);
            let following = *poll_follow.lock().unwrap_or_else(PoisonError::into_inner);
            let island_monitor = following.then(|| pointer::monitor_at((origin.0 + 1, origin.1 + 1))).flatten();
            Some(Target { regions: screen, island_monitor })
        },
        move |event| match event {
            PointerEvent::Interactive(on) => set_click_through(hwnd(raw), !on),
            PointerEvent::Hover(inside) => {
                let _ = events_app.emit_to(ISLAND_LABEL, "island://pointer", serde_json::json!({ "inside": inside }));
            }
            PointerEvent::TopEdge(monitor) => move_to_top_centre(hwnd(raw), monitor),
        },
    )?;
    app.manage(IslandState { service, regions, follow, _poller: poller });
    Ok(())
}

type Res<T> = Result<T, String>;

#[tauri::command]
pub fn island_ready(app: AppHandle) {
    if let Some(w) = app.get_webview_window(ISLAND_LABEL) {
        if let Ok(h) = w.hwnd() {
            crate::desktop_host::show_without_activating(crate::desktop_host::Hwnd::from_raw(h.0));
        }
    }
}

#[tauri::command]
pub fn island_state(s: State<'_, IslandState>) -> dotdock_island::service::InitialState {
    s.service.initial_state()
}

#[tauri::command]
pub fn island_set_regions(regions: Regions, s: State<'_, IslandState>) {
    *s.regions.lock().unwrap_or_else(PoisonError::into_inner) = regions;
}

#[tauri::command]
pub fn island_focus(id: String, s: State<'_, IslandState>) -> dotdock_island::focus::FocusOutcome {
    s.service.focus(&id)
}

#[tauri::command]
pub fn island_dismiss(id: String, s: State<'_, IslandState>) {
    s.service.dismiss(&id);
}

#[tauri::command]
pub fn island_connect(s: State<'_, IslandState>) -> Res<dotdock_island::service::ConnectionStatus> {
    s.service.connect().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn island_disconnect(s: State<'_, IslandState>) -> Res<dotdock_island::service::ConnectionStatus> {
    s.service.disconnect().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn island_connection(s: State<'_, IslandState>) -> dotdock_island::service::ConnectionStatus {
    s.service.connection()
}

#[tauri::command]
pub fn island_set_settings(settings: IslandSettings, s: State<'_, IslandState>) -> Res<IslandSettings> {
    let saved = s.service.set_settings(settings).map_err(|e| e.to_string())?;
    *s.follow.lock().unwrap_or_else(PoisonError::into_inner) = saved.follow_cursor;
    Ok(saved)
}

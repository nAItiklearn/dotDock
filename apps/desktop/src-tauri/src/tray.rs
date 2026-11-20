//! Tray icon: the always-available control point (MASTER_SPEC 9.6).

use crate::desktop_host::{self, Hwnd};
use dotdock_shell::modules::{ModuleId, ModuleStatus, State};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Wry};
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSMICON};

pub const SETTINGS_LABEL: &str = "settings";
/// Asks the overlay to toggle widget edit mode.
pub const EVENT_EDIT_MODE: &str = "overlay://toggle-edit";

const ID_SETTINGS: &str = "settings";
const ID_EDIT: &str = "edit";
const ID_VISIBILITY: &str = "visibility";
const ID_RESTORE: &str = "restore";
const ID_QUIT: &str = "quit";

const SETTINGS_SIZE: (f64, f64) = (960.0, 680.0);
const SETTINGS_MIN: (f64, f64) = (720.0, 520.0);

/// Opens Settings, or focuses it if already open. Created on demand and destroyed on close,
/// so it costs nothing while you are not using it.
pub fn open_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SETTINGS_LABEL) {
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App("settings.html".into()))
        .title("dotDock Settings")
        .inner_size(SETTINGS_SIZE.0, SETTINGS_SIZE.1)
        .min_inner_size(SETTINGS_MIN.0, SETTINGS_MIN.1)
        .center()
        .build();
    if let Err(err) = built {
        dotdock_shell::boot_log::record(&format!("settings window failed: {err}"));
    }
}

fn toggle_overlay(app: &AppHandle) {
    let Some(window) = app.get_webview_window(crate::home_host::OVERLAY_LABEL) else { return };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else if let Ok(hwnd) = window.hwnd() {
        desktop_host::show_without_activating(Hwnd::from_raw(hwnd.0));
    }
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        ID_SETTINGS => open_settings(app),
        ID_EDIT => {
            let _ = app.emit_to(crate::home_host::OVERLAY_LABEL, EVENT_EDIT_MODE, ());
        }
        ID_VISIBILITY => toggle_overlay(app),
        ID_RESTORE => {
            let outcome = dotdock_shell::restore::restore_windows();
            dotdock_shell::boot_log::record(&format!("tray restore: {outcome:?}"));
            app.exit(0);
        }
        ID_QUIT => app.exit(0),
        _ => {}
    }
}

/// The menu entries that only mean something while the home screen runs.
struct HomeItems {
    edit: MenuItem<Wry>,
    visibility: MenuItem<Wry>,
}

/// Greys out the home screen's entries while that part is off, so the menu never offers what is not there.
pub fn sync_modules(app: &AppHandle, statuses: &[ModuleStatus]) {
    let Some(items) = app.try_state::<HomeItems>() else { return };
    let running = statuses.iter().any(|s| s.id == ModuleId::Home && s.state == State::Running);
    // A menu entry that cannot be updated keeps its old state; the next change tries again.
    let _ = items.edit.set_enabled(running);
    let _ = items.visibility.set_enabled(running);
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let edit = MenuItem::with_id(app, ID_EDIT, "Edit widgets", false, None::<&str>)?;
    let visibility = MenuItem::with_id(app, ID_VISIBILITY, "Hide or show widgets", false, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, ID_SETTINGS, "Settings", true, None::<&str>)?,
            &edit,
            &visibility,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, ID_RESTORE, "Restore Windows desktop and quit", true, None::<&str>)?,
            &MenuItem::with_id(app, ID_QUIT, "Quit", true, None::<&str>)?,
        ],
    )?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("dotDock")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            // Left click opens Settings; right click shows the menu.
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                open_settings(tray.app_handle());
            }
        });
    if let Some(icon) = tray_icon(app) {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    app.manage(HomeItems { edit, visibility });
    Ok(())
}

/// The notification area draws the small-icon size (16 px at 100% scale, 32 px at 200%). The app's
/// .ico holds a hand-drawn image for each of those sizes, so ask for that one instead of letting
/// Windows shrink the large window icon, which blurs the 1 px gap between the dot and the pill.
fn tray_icon(app: &AppHandle) -> Option<Image<'static>> {
    // SAFETY: GetSystemMetrics has no preconditions; it returns 0 on failure.
    let small = unsafe { GetSystemMetrics(SM_CXSMICON) };
    u32::try_from(small)
        .ok()
        .filter(|size| *size > 0)
        .and_then(|size| Image::from_app_icon_resource(size).ok())
        .or_else(|| app.default_window_icon().cloned().map(Image::to_owned))
}

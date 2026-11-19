//! dotDock core: owns the desktop overlay window, providers and boot timing.

mod desktop_host;
mod providers;
mod tray;

use desktop_host::{HitRect, HitRegions, Hwnd};
use dotdock_shell::crash_guard::{self, StartDecision};
use dotdock_shell::providers::weather::{self, Place};
use dotdock_shell::wallpaper;
use dotdock_shell::{autostart, boot_log as boot};
use providers::{ProvidersReady, WeatherWake};
use std::time::Duration;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub(crate) const OVERLAY_LABEL: &str = "overlay";
/// If the UI never reports its first frame, show the window anyway rather than stay invisible.
const SHOW_FALLBACK: Duration = Duration::from_secs(3);

/// Called by the overlay once its listeners exist; providers replay current values.
#[tauri::command]
fn providers_ready(ready: State<'_, ProvidersReady>) {
    boot::mark("providers-ready");
    ready.mark();
}

/// Called after the first fully rendered frame (fonts loaded, cached data drawn).
#[tauri::command]
fn overlay_ready(app: AppHandle) {
    boot::mark("overlay-ready");
    show_overlay(&app);
}

/// Transport controls for the music widget. Runs off the UI thread (async command).
#[tauri::command]
async fn media_command(command: dotdock_shell::providers::media::MediaCommand) -> bool {
    dotdock_shell::providers::media::MediaProvider::new().command(command)
}

/// City search for the weather settings. Network call to Open-Meteo geocoding.
#[tauri::command]
async fn weather_search(query: String, language: String) -> Result<Vec<Place>, String> {
    weather::search(&query, &language).map_err(|e| e.to_string())
}

#[tauri::command]
fn weather_set_place(place: Place, wake: State<'_, WeatherWake>) -> Result<(), String> {
    weather::save_place(&place).map_err(|e| e.to_string())?;
    wake.wake();
    Ok(())
}

/// One bundled wallpaper for the Settings picker.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WallpaperItem {
    id: String,
    name: String,
    style: String,
    mode: String,
    accent: String,
    path: String,
    /// Web path of the small preview, e.g. `/wallpaper-thumbs/paper-ring-dark.jpg`.
    thumb: Option<String>,
}

fn bundled_wallpapers_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().resource_dir().map(|d| d.join("wallpapers")).map_err(|e| e.to_string())
}

#[tauri::command]
async fn wallpapers_list(app: AppHandle) -> Result<Vec<WallpaperItem>, String> {
    let dir = bundled_wallpapers_dir(&app)?;
    let items = wallpaper::bundled(&dir).map_err(|e| e.to_string())?;
    Ok(items
        .into_iter()
        .map(|(e, path)| WallpaperItem {
            id: e.id,
            name: e.name,
            style: e.style,
            mode: e.mode,
            accent: e.accent,
            thumb: e.thumb.map(|t| format!("/{t}")),
            path: path.to_string_lossy().into_owned(),
        })
        .collect())
}

/// Sets a bundled wallpaper as the real Windows wallpaper (all monitors when `monitor` is None).
#[tauri::command]
async fn wallpaper_apply(
    app: AppHandle,
    id: String,
    mode: String,
    fit: wallpaper::Fit,
    monitor: Option<String>,
) -> Result<(), String> {
    let dir = bundled_wallpapers_dir(&app)?;
    let items = wallpaper::bundled(&dir).map_err(|e| e.to_string())?;
    let (_, path) = items
        .into_iter()
        .find(|(e, _)| e.id == id && e.mode == mode)
        .ok_or_else(|| format!("no bundled wallpaper {id} ({mode})"))?;
    wallpaper::apply(&path, monitor.as_deref(), fit).map_err(|e| e.to_string())
}

#[tauri::command]
async fn wallpaper_monitors() -> Result<Vec<String>, String> {
    wallpaper::monitors().map_err(|e| e.to_string())
}

/// The in-app "Restore Windows desktop" action.
#[tauri::command]
async fn restore_windows() -> Result<(), String> {
    dotdock_shell::restore::restore_windows().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn autostart_set(enabled: bool) -> Result<(), String> {
    if enabled {
        autostart::enable().map(|_| ()).map_err(|e| e.to_string())
    } else {
        autostart::disable().map_err(|e| e.to_string())
    }
}

/// A widget text field gained (`true`) or lost focus.
#[tauri::command]
fn overlay_set_typing(app: AppHandle, typing: bool) {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else { return };
    if let Ok(hwnd) = window.hwnd() {
        desktop_host::set_typing(Hwnd::from_raw(hwnd.0), typing);
    }
}

#[tauri::command]
fn set_hit_regions(rects: Vec<HitRect>, regions: State<'_, HitRegions>) {
    regions.replace(rects);
}

fn show_overlay(app: &AppHandle) {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else { return };
    if window.is_visible().unwrap_or(false) {
        return;
    }
    let Ok(hwnd) = window.hwnd() else { return };
    // Never steal focus from what the user is doing when the widgets appear.
    if desktop_host::show_without_activating(Hwnd::from_raw(hwnd.0)) {
        boot::mark("shown");
    }
}

fn create_overlay(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    // Size and position come from Win32 in desktop_host (and are re-fitted on display changes).
    let window = WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App("overlay.html".into()))
        .title("Desktop")
        .visible(false)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .additional_browser_args(
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required",
        )
        .always_on_bottom(true)
        .build()?;
    desktop_host::configure(Hwnd::from_raw(window.hwnd()?.0));
    Ok(window)
}

/// One-shot commands handled before any window exists. Exits the process if one ran.
fn run_cli_command() -> bool {
    let Some(arg) = std::env::args().nth(1) else { return false };
    let outcome = match arg.as_str() {
        "--enable-autostart" => {
            autostart::enable().map(|m| format!("autostart enabled via {m:?}")).map_err(|e| e.to_string())
        }
        "--disable-autostart" => {
            autostart::disable().map(|()| "autostart disabled".to_owned()).map_err(|e| e.to_string())
        }
        // Run by the uninstaller, and the in-app "Restore Windows desktop" action.
        "--restore-windows" => {
            dotdock_shell::restore::restore_windows().map(|r| format!("restored: {r:?}")).map_err(|e| e.to_string())
        }
        _ => return false,
    };
    let (line, code) = match outcome {
        Ok(msg) => (msg, 0),
        Err(err) => (format!("{arg} failed: {err}"), 1),
    };
    boot::record(&line);
    println!("{line}");
    // Non-zero on failure so the uninstaller and scripts can tell.
    std::process::exit(code);
}

/// Plain native notice; used before any webview exists (safe mode, crash-guard report).
fn notice(text: &str) {
    use windows::core::HSTRING;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONINFORMATION, MB_OK};
    // SAFETY: modal message box with owned wide strings and no owner window.
    unsafe {
        MessageBoxW(None, &HSTRING::from(text), &HSTRING::from("dotDock"), MB_OK | MB_ICONINFORMATION);
    }
}

fn shift_held() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_SHIFT};
    // SAFETY: reads global key state; no pointers involved. High bit set = key is down.
    unsafe { GetAsyncKeyState(i32::from(VK_SHIFT.0)) < 0 }
}

pub fn run() {
    crash_guard::install_panic_hook();
    if run_cli_command() {
        return;
    }
    boot::record_process_start();
    let launched_at_sign_in = std::env::args().any(|a| a == autostart::AUTOSTART_ARG);
    if shift_held() {
        boot::mark("safe-mode");
        notice("Safe mode: dotDock started without changing your desktop.\n\nStart it again without holding Shift to bring your widgets back.");
        return;
    }
    if let StartDecision::Tripped = crash_guard::on_start() {
        // At sign-in, stay quiet: the user is told on their next manual launch.
        if !launched_at_sign_in {
            notice("dotDock stopped unexpectedly several times, so it put your Windows desktop back the way it was and turned off starting with Windows.\n\nYou can start it again any time.");
            crash_guard::take_tripped_notice();
        }
        return;
    }
    if !launched_at_sign_in && crash_guard::take_tripped_notice().is_some() {
        notice("Earlier, dotDock stopped unexpectedly several times at sign-in, so it put your Windows desktop back and turned off starting with Windows.\n\nIt is starting normally now.");
    }
    let ready = ProvidersReady::default();
    let regions = HitRegions::default();
    let result = tauri::Builder::default()
        // A second launch opens Settings in the running instance (MASTER_SPEC 7.4).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::open_settings(app)))
        .manage(ready.clone())
        .manage(regions.clone())
        .invoke_handler(tauri::generate_handler![
            providers_ready,
            overlay_ready,
            set_hit_regions,
            overlay_set_typing,
            media_command,
            weather_search,
            weather_set_place,
            wallpapers_list,
            wallpaper_apply,
            wallpaper_monitors,
            restore_windows,
            autostart_set
        ])
        .setup(move |app| {
            boot::mark("setup");
            let handle = app.handle().clone();
            let window = create_overlay(&handle)?;
            boot::mark("window-created");
            tray::install(&handle)?;
            let wake = providers::spawn(handle.clone(), ready)?;
            app.manage(wake);
            desktop_host::spawn_guard(Hwnd::from_raw(window.hwnd()?.0), regions)?;
            std::thread::spawn(|| {
                std::thread::sleep(crash_guard::stable_after());
                crash_guard::mark_stable();
            });
            std::thread::spawn(move || {
                std::thread::sleep(SHOW_FALLBACK);
                if handle.get_webview_window(OVERLAY_LABEL).is_some_and(|w| !w.is_visible().unwrap_or(true)) {
                    boot::mark("show-fallback");
                }
                show_overlay(&handle);
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .map(|app| {
            app.run(|_, event| {
                // A clean exit is never a crash.
                if let tauri::RunEvent::Exit = event {
                    crash_guard::mark_stable();
                }
            })
        });
    if let Err(err) = result {
        boot::record(&format!("fatal {err}"));
    }
}

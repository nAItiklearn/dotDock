//! dotDock core: owns the desktop overlay window, providers and boot timing.

mod desktop_host;
mod providers;

use desktop_host::{HitRect, HitRegions, Hwnd};
use dotdock_shell::providers::weather::{self, Place};
use dotdock_shell::{autostart, boot_log as boot};
use providers::{ProvidersReady, WeatherWake};
use std::time::Duration;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const OVERLAY_LABEL: &str = "overlay";
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

#[tauri::command]
async fn media_seek(seconds: f64) -> bool {
    dotdock_shell::providers::media::MediaProvider::new().seek(seconds)
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

pub fn run() {
    if run_cli_command() {
        return;
    }
    boot::record_process_start();
    let ready = ProvidersReady::default();
    let regions = HitRegions::default();
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {
            // A second launch is a no-op until the Settings window exists.
        }))
        .manage(ready.clone())
        .manage(regions.clone())
        .invoke_handler(tauri::generate_handler![
            providers_ready,
            overlay_ready,
            set_hit_regions,
            media_command,
            media_seek,
            weather_search,
            weather_set_place
        ])
        .setup(move |app| {
            boot::mark("setup");
            let handle = app.handle().clone();
            let window = create_overlay(&handle)?;
            boot::mark("window-created");
            let wake = providers::spawn(handle.clone(), ready)?;
            app.manage(wake);
            desktop_host::spawn_guard(Hwnd::from_raw(window.hwnd()?.0), regions)?;
            std::thread::spawn(move || {
                std::thread::sleep(SHOW_FALLBACK);
                if handle.get_webview_window(OVERLAY_LABEL).is_some_and(|w| !w.is_visible().unwrap_or(true)) {
                    boot::mark("show-fallback");
                }
                show_overlay(&handle);
            });
            Ok(())
        })
        .run(tauri::generate_context!());
    if let Err(err) = result {
        boot::record(&format!("fatal {err}"));
    }
}

//! dotDock core: owns the desktop overlay window, providers and boot timing.

mod desktop_host;
mod providers;

use desktop_host::{HitRect, HitRegions};
use dotdock_shell::{autostart, boot_log as boot};
use providers::ProvidersReady;
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

#[tauri::command]
fn set_hit_regions(rects: Vec<HitRect>, regions: State<'_, HitRegions>) {
    regions.replace(rects);
}

fn show_overlay(app: &AppHandle) {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else { return };
    if window.is_visible().unwrap_or(false) {
        return;
    }
    if window.show().is_ok() {
        boot::mark("shown");
    }
}

fn create_overlay(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let monitor = app.primary_monitor()?.ok_or(tauri::Error::WindowNotFound)?;
    let size = monitor.size();
    let position = monitor.position();
    let window = WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App("overlay.html".into()))
        .title("Desktop")
        .visible(false)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .always_on_bottom(true)
        .build()?;
    window.set_position(*position)?;
    window.set_size(*size)?;
    desktop_host::configure(&window)?;
    Ok(window)
}

/// One-shot commands handled before any window exists. Returns true if one ran.
fn run_cli_command() -> bool {
    let Some(arg) = std::env::args().nth(1) else { return false };
    let outcome = match arg.as_str() {
        "--enable-autostart" => autostart::enable().map(|m| format!("autostart enabled via {m:?}")),
        "--disable-autostart" => autostart::disable().map(|()| "autostart disabled".to_owned()),
        _ => return false,
    };
    let line = match outcome {
        Ok(msg) => msg,
        Err(err) => format!("autostart error: {err}"),
    };
    boot::record(&line);
    println!("{line}");
    true
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
        .invoke_handler(tauri::generate_handler![providers_ready, overlay_ready, set_hit_regions])
        .setup(move |app| {
            boot::mark("setup");
            let handle = app.handle().clone();
            let window = create_overlay(&handle)?;
            boot::mark("window-created");
            providers::spawn(handle.clone(), ready)?;
            desktop_host::spawn_hit_tester(window, regions)?;
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

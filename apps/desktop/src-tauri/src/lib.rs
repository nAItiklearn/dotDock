//! dotDock core: owns the desktop overlay window, providers and boot timing.

mod desktop_host;
mod home_host;
mod island_host;
mod lifecycle;
mod modules_host;
mod providers;
mod tray;

use desktop_host::HitRegions;
use dotdock_shell::crash_guard::{self, StartDecision};
use dotdock_shell::providers::weather::{self, Place};
use dotdock_shell::wallpaper;
use dotdock_shell::{autostart, boot_log as boot, dock_guard, sentinel};
use home_host::HomeState;
use tauri::{AppHandle, Manager, State};

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
fn weather_set_place(place: Place, home: State<'_, HomeState>) -> Result<(), String> {
    weather::save_place(&place).map_err(|e| e.to_string())?;
    home.wake_weather();
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

/// The picture Windows is showing as the wallpaper, as the raw bytes of its file, for Settings to
/// read the colours of. The path is Windows' own answer; the caller cannot name a file.
#[tauri::command]
async fn wallpaper_current_image() -> Result<tauri::ipc::Response, String> {
    wallpaper::current_image().map(tauri::ipc::Response::new).map_err(|e| e.to_string())
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

/// The restore watchdog runs from this exe when `dotdock-sentinel.exe` is not beside it (the
/// portable exe, a dev run): `dotdock.exe --sentinel <launch|watch> <pid>`. Exits the process if so.
fn run_hosted_sentinel() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some(sentinel::HOST_ARG) {
        std::process::exit(sentinel::run(&args));
    }
}

pub fn run() {
    run_hosted_sentinel();
    crash_guard::install_panic_hook();
    if run_cli_command() {
        return;
    }
    boot::record_process_start();
    // Before anything else: if the last run left the taskbar hidden (power loss, or even the
    // sentinel was killed), it comes back now. Also in safe mode: showing it is always safe.
    dock_guard::recover_if_dirty();
    let launched_at_sign_in = std::env::args().any(|a| a == autostart::AUTOSTART_ARG);
    // Safe mode returns before any window exists, so nothing can hide the taskbar in it.
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
    let result = tauri::Builder::default()
        // A second launch opens Settings in the running instance (MASTER_SPEC 7.4).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::open_settings(app)))
        .manage(HitRegions::default())
        .invoke_handler(tauri::generate_handler![
            home_host::providers_ready,
            home_host::overlay_ready,
            home_host::set_hit_regions,
            home_host::overlay_set_typing,
            modules_host::modules_list,
            modules_host::modules_set,
            island_host::island_ready,
            island_host::island_state,
            island_host::island_set_regions,
            island_host::island_focus,
            island_host::island_dismiss,
            island_host::island_connect,
            island_host::island_disconnect,
            island_host::island_connection,
            island_host::island_set_settings,
            media_command,
            weather_search,
            weather_set_place,
            wallpapers_list,
            wallpaper_apply,
            wallpaper_current_image,
            wallpaper_monitors,
            restore_windows,
            autostart_set
        ])
        .setup(move |app| {
            boot::mark("setup");
            let handle = app.handle().clone();
            tray::install(&handle)?;
            modules_host::install(&handle);
            // The parts start on their own thread: building a window waits for the main thread, which
            // is only free once setup returns.
            modules_host::start_enabled(&handle)?;
            std::thread::spawn(|| {
                std::thread::sleep(crash_guard::stable_after());
                crash_guard::mark_stable();
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .map(|app| {
            app.run(|_, event| match event {
                // With every window closed (the home screen and notch off, Settings closed) the tray
                // keeps dotDock running. Only an explicit exit, which carries a code, quits.
                tauri::RunEvent::ExitRequested { api, code: None, .. } => api.prevent_exit(),
                // A clean exit is never a crash, and never leaves the taskbar hidden.
                tauri::RunEvent::Exit => {
                    dock_guard::restore_after_dock();
                    crash_guard::mark_stable();
                }
                _ => {}
            })
        });
    if let Err(err) = result {
        boot::record(&format!("fatal {err}"));
    }
}

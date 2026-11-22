//! dotDock core: owns the desktop overlay window, providers and boot timing.

mod core_commands;
mod desktop_host;
mod dock_host;
mod home_host;
mod island_host;
mod lifecycle;
mod modules_host;
mod providers;
mod tiles_host;
mod tray;
mod updater;
mod wallpaper_host;

use desktop_host::HitRegions;
use dotdock_shell::crash_guard::{self, StartDecision};
use dotdock_shell::first_run::{self, FirstStart};
use dotdock_shell::providers::weather::{self, Place};
use dotdock_shell::wallpaper;
use dotdock_shell::{autostart, boot_log as boot, dock_guard, instance, sentinel};
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

/// The default wallpaper of a first start. Applying waits on COM and the shell, so it runs off the setup thread.
fn apply_first_run_wallpaper(app: &AppHandle, first: FirstStart) {
    let outcome = match core_commands::bundled_dir(app) {
        Ok(dir) => first.apply_default(&dir, |path| {
            wallpaper::apply(path, None, wallpaper::Fit::default()).map_err(|e| e.to_string())
        }),
        Err(reason) => first_run::Outcome::Failed(reason),
    };
    boot::record(&format!("first start wallpaper: {outcome:?}"));
}

/// The picture Windows is showing as the wallpaper, as the raw bytes of its file, for Settings to
/// read the colours of. The path is Windows' own answer; the caller cannot name a file.
#[tauri::command]
async fn wallpaper_current_image() -> Result<tauri::ipc::Response, String> {
    wallpaper::current_image().map(tauri::ipc::Response::new).map_err(|e| e.to_string())
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
    // A later launch only hands over to the running app: the single-instance plugin forwards it and
    // exits while the app is built. Nothing below may run for it (see `instance`).
    let primary = instance::is_primary();
    if primary && !prepare_primary_start() {
        return;
    }
    build_and_run(primary);
}

/// The checks of the launch that runs the app. False when it must not start (safe mode, crash loop).
fn prepare_primary_start() -> bool {
    boot::record_process_start();
    // Before anything else: if the last run left the taskbar hidden (power loss, or even the
    // sentinel was killed), it comes back now. Also in safe mode: showing it is always safe.
    dock_guard::recover_if_dirty();
    let launched_at_sign_in = std::env::args().any(|a| a == autostart::AUTOSTART_ARG);
    // Safe mode returns before any window exists, so nothing can hide the taskbar in it.
    if shift_held() {
        boot::mark("safe-mode");
        notice("Safe mode: dotDock started without changing your desktop.\n\nStart it again without holding Shift to bring your widgets back.");
        return false;
    }
    if let StartDecision::Tripped = crash_guard::on_start() {
        // At sign-in, stay quiet: the user is told on their next manual launch.
        if !launched_at_sign_in {
            notice("dotDock stopped unexpectedly several times, so it put your Windows desktop back the way it was and turned off starting with Windows.\n\nYou can start it again any time.");
            crash_guard::take_tripped_notice();
        }
        return false;
    }
    if !launched_at_sign_in && crash_guard::take_tripped_notice().is_some() {
        notice("Earlier, dotDock stopped unexpectedly several times at sign-in, so it put your Windows desktop back and turned off starting with Windows.\n\nIt is starting normally now.");
    }
    true
}

fn build_and_run(primary: bool) {
    let launched_at_sign_in = std::env::args().any(|a| a == autostart::AUTOSTART_ARG);
    let result = tauri::Builder::default()
        // A second launch opens Settings in the running instance (MASTER_SPEC 7.4).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::open_settings(app)))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::UpdaterState::default())
        .manage(HitRegions::default())
        .register_uri_scheme_protocol(core_commands::WALLPAPER_SCHEME, |_ctx, request| {
            core_commands::serve_wallpaper(&request)
        })
        .register_asynchronous_uri_scheme_protocol(dotdock_dock::icons::SCHEME, dock_host::serve_icon)
        .invoke_handler(tauri::generate_handler![
            home_host::providers_ready,
            home_host::overlay_ready,
            home_host::set_hit_regions,
            home_host::overlay_set_typing,
            home_host::overlay_work_area,
            modules_host::environment_get,
            modules_host::environment_set,
            island_host::island_ready,
            island_host::island_state,
            island_host::island_set_regions,
            island_host::island_focus,
            island_host::island_dismiss,
            island_host::island_connect,
            island_host::island_disconnect,
            island_host::island_connect_agent,
            island_host::island_disconnect_agent,
            island_host::island_connection,
            island_host::island_set_settings,
            dock_host::dock_ready,
            dock_host::dock_launch,
            dock_host::dock_activate,
            dock_host::dock_close_window,
            dock_host::dock_set_category,
            dock_host::dock_save_categories,
            dock_host::dock_set_settings,
            dock_host::dock_set_regions,
            dock_host::dock_preview,
            dock_host::dock_set_focus,
            tiles_host::dock_tiles_watch,
            tiles_host::dock_tiles_unwatch,
            tiles_host::dock_mic_watch,
            tiles_host::dock_mic_unwatch,
            tiles_host::dock_contact,
            tiles_host::dock_join_meeting,
            tiles_host::dock_stopwatch,
            tiles_host::dock_toggle_mic,
            tiles_host::dock_hydration,
            tiles_host::dock_audio,
            tiles_host::dock_toggles,
            tiles_host::dock_open_url,
            media_command,
            weather_search,
            weather_set_place,
            wallpaper_current_image,
            wallpaper_host::wallpaper_announced_image,
            core_commands::startup_get,
            core_commands::startup_set,
            core_commands::restore_windows,
            core_commands::displays_list,
            core_commands::wallpapers_list,
            core_commands::wallpapers_assignments,
            core_commands::wallpapers_assign,
            core_commands::wallpapers_import,
            core_commands::wallpapers_remove,
            core_commands::shortcuts_register,
            core_commands::settings_open,
            core_commands::overlay_edit_mode,
            core_commands::app_info,
            core_commands::app_open_data_folder,
            core_commands::settings_dock_get,
            core_commands::settings_dock_set,
            core_commands::settings_dock_apps,
            updater::updater_status,
            updater::updater_check,
            updater::updater_install
        ])
        .setup(move |app| {
            // The plugin only lets a later launch through while the running app is still before its
            // own build (a modal notice, a quick double click). It must not become a second app.
            if !primary {
                std::process::exit(0);
            }
            boot::mark("setup");
            let handle = app.handle().clone();
            tray::install(&handle)?;
            app.manage(core_commands::HotkeyState::start(&handle));
            // Decided before any window exists: the first window creates the traces of an earlier run.
            let first_start = dotdock_shell::app_data_dir().and_then(|dir| first_run::claim(&dir));
            modules_host::install(&handle);
            // Before the dock host: its window passes Windows' wallpaper announcements on.
            wallpaper_host::start(&handle)?;
            // The dock's backend and host come up without a window; the dock and taskbar parts decide
            // whether it shows and whether it takes the taskbar's place.
            dock_host::start(&handle)?;
            boot::mark("dock-started");
            tiles_host::start(&handle);
            // The parts start on their own thread: building a window waits for the main thread, which
            // is only free once setup returns.
            modules_host::start_enabled(&handle)?;
            modules_host::open_settings_if_off(&handle, launched_at_sign_in);
            if let Some(first) = first_start {
                let app = handle.clone();
                std::thread::spawn(move || apply_first_run_wallpaper(&app, first));
            }
            updater::schedule_startup_check(handle.clone());
            std::thread::spawn(|| {
                std::thread::sleep(crash_guard::stable_after());
                crash_guard::mark_stable();
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .map(|app| {
            app.run(|app, event| match event {
                // With every window closed (the home screen and notch off, Settings closed) the tray
                // keeps dotDock running. Only an explicit exit, which carries a code, quits.
                tauri::RunEvent::ExitRequested { api, code: None, .. } => api.prevent_exit(),
                // A clean exit is never a crash, and never leaves the taskbar hidden.
                tauri::RunEvent::Exit => {
                    // The hosts first: the dock host stops its taskbar worker, so nothing hides the
                    // taskbar after the restore.
                    tiles_host::shutdown(app);
                    dock_host::shutdown(app);
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

//! Wires the module manager into the app: the two switches at the end of Settings, the event that
//! tells every window their answer, and the one place where the parts are plugged in.
//!
//! The manager itself (`dotdock_shell::modules`) knows nothing about windows. A part is a
//! `Lifecycle`; `start_enabled` registers each part this build has, and a part registered there
//! starts at once if the environment is on. The dock host plugs in beside the home screen and the
//! notch, with one `register` line per part it owns (`ModuleId::Dock`, `ModuleId::Taskbar`); until
//! it does, the Windows taskbar stays and Settings says there is no replacement to switch to.

use crate::home_host::{Home, HomeState};
use crate::island_host::{IslandSlot, Notch};
use crate::tray;
use dotdock_shell::modules::{Environment, ModuleId, Modules};
use dotdock_shell::{boot_log as boot, dock_guard, handover};
use std::sync::{Mutex, PoisonError};
use tauri::{AppHandle, Emitter, Manager};

/// Emitted to every window with the `Environment` whenever any part starts or stops.
pub const EVENT_CHANGED: &str = "environment://changed";

/// Creates the manager and the state each part keeps. Call once, in setup, before `start_enabled`.
pub fn install(app: &AppHandle) {
    app.manage(HomeState::default());
    app.manage(IslandSlot::default());
    let notify = app.clone();
    let modules =
        Modules::new(dotdock_shell::app_data_dir().as_deref(), dock_guard::restore_after_dock, move |statuses| {
            let _ = notify.emit(EVENT_CHANGED, notify.state::<Modules>().environment());
            tray::sync_modules(&notify, statuses);
        });
    app.manage(modules);
}

/// Plugs in every part this build has, on a thread of its own: building a window waits for the main
/// thread, which is only free once setup has returned.
pub fn start_enabled(app: &AppHandle) -> std::io::Result<()> {
    let app = app.clone();
    std::thread::Builder::new().name("modules-start".into()).spawn(move || {
        let modules = app.state::<Modules>();
        modules.register(ModuleId::Home, Box::new(Home::new(app.clone())));
        modules.register(ModuleId::Notch, Box::new(Notch::new(app.clone())));
    })?;
    Ok(())
}

#[tauri::command]
pub async fn environment_get(modules: tauri::State<'_, Modules>) -> Result<Environment, String> {
    Ok(modules.environment())
}

/// Switches the dotDock theme, the whole environment, on or off. Off stops every part, then hands the
/// desktop back to Windows: dotDock's wallpapers and launch at sign-in are recorded, and Windows is
/// restored as `tools/restore-windows.ps1` does it. On puts the recorded desktop back first, then starts
/// the parts. Starting or stopping waits for windows, threads and the shell, so it runs off the async workers.
#[tauri::command]
pub async fn environment_set(app: AppHandle, on: bool) -> Result<Environment, String> {
    tauri::async_runtime::spawn_blocking(move || switch_theme(&app, on)).await.map_err(|e| e.to_string())?
}

/// One switch at a time, from any window: the desktop hand-over runs outside the manager's own lock.
static SWITCHING: Mutex<()> = Mutex::new(());

/// The parts and the desktop always switch together. When the desktop part fails, the parts have still
/// switched, so the answer is the new state with what did not come along named in its problems.
fn switch_theme(app: &AppHandle, on: bool) -> Result<Environment, String> {
    let _one_at_a_time = SWITCHING.lock().unwrap_or_else(PoisonError::into_inner);
    let modules = app.state::<Modules>();
    let dir = dotdock_shell::app_data_dir().ok_or("LOCALAPPDATA is not set")?;
    if on {
        let taken = handover::take_over(&dir, &handover::Windows);
        boot::record(&format!("theme on: {taken:?}"));
        let mut environment = modules.set_environment(true).map_err(|e| e.to_string())?;
        if let Err(e) = taken {
            environment.problems.push(format!("{e}, so the Windows wallpaper stays for now."));
        }
        Ok(environment)
    } else {
        let mut environment = modules.set_environment(false).map_err(|e| e.to_string())?;
        let handed = handover::hand_back(&dir, &handover::Windows);
        boot::record(&format!("theme off: {handed:?}"));
        if let Err(e) = handed {
            environment.problems.push(format!("{e}."));
        }
        Ok(environment)
    }
}

/// Keeps the Windows taskbar (`use_windows`), or lets the dock's replacement take its place.
#[tauri::command]
pub async fn taskbar_set(app: AppHandle, use_windows: bool) -> Result<Environment, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Modules>().set_windows_taskbar(use_windows).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

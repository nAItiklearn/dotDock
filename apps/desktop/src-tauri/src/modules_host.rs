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
use dotdock_shell::dock_guard;
use dotdock_shell::modules::{Environment, ModuleId, Modules};
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

/// Switches the whole dotDock environment on or off. Starting or stopping waits for windows and
/// threads, so it runs off the async workers.
#[tauri::command]
pub async fn environment_set(app: AppHandle, on: bool) -> Result<Environment, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Modules>().set_environment(on).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
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

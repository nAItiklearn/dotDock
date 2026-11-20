//! Wires the module manager into the app: what Settings calls to switch a part on or off, the event
//! that tells every window the answer, and the one place where the parts are plugged in.
//!
//! The manager itself (`dotdock_shell::modules`) knows nothing about windows. A part is a
//! `Lifecycle`; `start_enabled` registers each part this build has, and a part registered there
//! starts at once if the user has it on. The dock host plugs in beside the home screen and the
//! notch, with one `register` line per part it owns (`ModuleId::Dock`, `ModuleId::Taskbar`);
//! until it does, those parts report themselves as not in this build.

use crate::home_host::{Home, HomeState};
use crate::island_host::{IslandSlot, Notch};
use crate::tray;
use dotdock_shell::dock_guard;
use dotdock_shell::modules::{ModuleId, ModuleStatus, Modules};
use tauri::{AppHandle, Emitter, Manager};

/// Emitted to every window with the full list of `ModuleStatus` whenever any part changes.
pub const EVENT_CHANGED: &str = "modules://changed";

/// Creates the manager and the state each part keeps. Call once, in setup, before `start_enabled`.
pub fn install(app: &AppHandle) {
    app.manage(HomeState::default());
    app.manage(IslandSlot::default());
    let notify = app.clone();
    let modules =
        Modules::new(dotdock_shell::app_data_dir().as_deref(), dock_guard::restore_after_dock, move |statuses| {
            let _ = notify.emit(EVENT_CHANGED, statuses);
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
pub async fn modules_list(modules: tauri::State<'_, Modules>) -> Result<Vec<ModuleStatus>, String> {
    Ok(modules.statuses())
}

/// Switches a part on or off and answers with the new status of every part. Starting or stopping
/// waits for windows and threads, so it runs off the async workers.
#[tauri::command]
pub async fn modules_set(app: AppHandle, id: ModuleId, enabled: bool) -> Result<Vec<ModuleStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Modules>().set_enabled(id, enabled).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

//! Wires the module manager into the app: the dotDock theme switch at the end of Settings, the event
//! that tells every window its answer, and the one place where the parts are plugged in.
//!
//! The manager itself (`dotdock_shell::modules`) knows nothing about windows. A part is a
//! `Lifecycle`; `start_enabled` registers each part this build has, and a part registered there
//! starts at once if the environment is on. The dock host owns two parts: the dock (`ModuleId::Dock`)
//! and its taking the Windows taskbar's place (`ModuleId::Taskbar`). When the dock's backend could
//! not start, neither is registered: the Windows taskbar stays and Settings says there is no
//! replacement to switch to.

use crate::dock_host::{DockPart, DockState, TaskbarPart};
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
            let _ = notify.emit(EVENT_CHANGED, environment(&notify.state::<Modules>()));
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
        // The dock first: it is what the user reaches for, so its window gets the first WebView2 start-up.
        if app.try_state::<DockState>().is_some() {
            modules.register(ModuleId::Dock, Box::new(DockPart::new(app.clone())));
            modules.register(ModuleId::Taskbar, Box::new(TaskbarPart::new(app.clone())));
        }
        modules.register(ModuleId::Home, Box::new(Home::new(app.clone())));
        // Without a Claude Code folder the notch has nothing to watch: it is not part of this run, rather
        // than a part that failed, so the theme switch carries no warning for most users.
        if Notch::has_sessions_to_watch() {
            modules.register(ModuleId::Notch, Box::new(Notch::new(app.clone())));
        }
    })?;
    Ok(())
}

/// What the last switch of the desktop could not do. Kept until the next switch, so every later read
/// and event still names it, not only the answer to the click.
static HANDOVER_PROBLEM: Mutex<Option<String>> = Mutex::new(None);

fn set_handover_problem(problem: Option<String>) {
    *HANDOVER_PROBLEM.lock().unwrap_or_else(PoisonError::into_inner) = problem;
}

/// The environment as every window sees it: the parts' state and the last hand-over problem, if any.
fn environment(modules: &Modules) -> Environment {
    let mut environment = modules.environment();
    if let Some(problem) = HANDOVER_PROBLEM.lock().unwrap_or_else(PoisonError::into_inner).clone() {
        environment.problems.push(problem);
    }
    environment
}

/// A manual launch with the theme off would otherwise show only a tray icon: open Settings, where the
/// switch to bring dotDock back is. At sign-in the theme is off on purpose, so nothing opens.
pub fn open_settings_if_off(app: &AppHandle, launched_at_sign_in: bool) {
    if !launched_at_sign_in && !app.state::<Modules>().environment().on {
        tray::open_settings(app);
    }
}

#[tauri::command]
pub async fn environment_get(modules: tauri::State<'_, Modules>) -> Result<Environment, String> {
    Ok(environment(&modules))
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
    // Already there (a second Settings window, a repeated click): switching again would restore Windows
    // a second time and put the snapshot wallpaper over the user's own.
    if modules.environment().on == on {
        return Ok(environment(&modules));
    }
    let dir = dotdock_shell::app_data_dir().ok_or("LOCALAPPDATA is not set")?;
    if on {
        let taken = handover::take_over(&dir, &handover::Windows);
        boot::record(&format!("theme on: {taken:?}"));
        if let Err(e) = modules.set_environment(true) {
            // The choice could not be saved, so the theme stays off: hand the desktop back again rather
            // than leave dotDock's wallpaper and launch at sign-in on with nothing running.
            let handed = handover::hand_back(&dir, &handover::Windows);
            boot::record(&format!("theme on undone: {handed:?}"));
            return Err(e.to_string());
        }
        set_handover_problem(match taken {
            Err(e) => Some(format!("{e}, so the Windows wallpaper stays for now.")),
            Ok(t) if !t.nothing_recorded && !t.windows_kept => Some(
                "Your Windows wallpaper could not be saved, so switching off again shows the one from before dotDock."
                    .to_owned(),
            ),
            Ok(_) => None,
        });
    } else {
        modules.set_environment(false).map_err(|e| e.to_string())?;
        let handed = handover::hand_back(&dir, &handover::Windows);
        boot::record(&format!("theme off: {handed:?}"));
        set_handover_problem(handed.err().map(|e| format!("{e}.")));
    }
    let environment = environment(&modules);
    // The parts' own change already told every window; this one carries the hand-over problem too.
    let _ = app.emit(EVENT_CHANGED, environment.clone());
    Ok(environment)
}

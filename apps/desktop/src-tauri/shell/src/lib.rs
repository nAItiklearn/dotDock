//! Windows shell integration for dotDock: launch at sign-in, the original-state
//! snapshot, boot timing and system data readers. No UI framework, so it is
//! unit-testable on any Windows toolchain.

pub mod autostart;
pub mod boot_log;
pub mod crash_guard;
pub mod dock_guard;
pub mod modules;
mod process;
pub mod providers;
mod registry;
pub mod restore;
pub mod run_gate;
pub mod sentinel;
pub mod snapshot;
pub mod taskbar;
pub mod wallpaper;

use std::path::PathBuf;

/// App data lives in the identifier-named folder, not `%LOCALAPPDATA%\dotDock`: the per-user
/// installer puts the program there, and an uninstall must never take the snapshot with it.
const APP_DIR: &str = "dev.dotdock.desktop";
/// Name of the logon task and of the Run value; tools/restore-windows.ps1 uses the same name.
const AUTOSTART_NAME: &str = "dotDock";
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const SERIALIZE_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\Serialize";
const STARTUP_DELAY_VALUE: &str = "StartupDelayInMSec";

/// `%LOCALAPPDATA%\dev.dotdock.desktop`, created on first use.
pub fn app_data_dir() -> Option<PathBuf> {
    let dir = PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join(APP_DIR);
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

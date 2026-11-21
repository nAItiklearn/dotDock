//! Helpers for taking a module down completely: wait for its threads, and for its window to be gone.
//! Both block, so they must never run on the main thread, which has to stay free to close the window.

use dotdock_shell::boot_log;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// How long stopping waits for a thread or a window. Past it the problem is logged and stopping goes
/// on: a stuck thread must not hang the Settings window that asked for the module to stop.
const PATIENCE: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(10);

/// Waits for a thread that has been told to stop.
pub fn join(handle: JoinHandle<()>) {
    let name = handle.thread().name().unwrap_or("unnamed").to_owned();
    let deadline = Instant::now() + PATIENCE;
    while !handle.is_finished() {
        if Instant::now() >= deadline {
            boot_log::record(&format!("module: thread {name} did not stop in time"));
            return;
        }
        std::thread::sleep(POLL);
    }
    let _ = handle.join();
}

/// Destroys a window and waits until its label is free again, so the module can be started again at once.
pub fn destroy_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        if let Err(err) = window.destroy() {
            boot_log::record(&format!("module: window {label} could not be destroyed: {err}"));
        }
    }
    let deadline = Instant::now() + PATIENCE;
    while app.get_webview_window(label).is_some() {
        if Instant::now() >= deadline {
            boot_log::record(&format!("module: window {label} did not close in time"));
            return;
        }
        std::thread::sleep(POLL);
    }
}

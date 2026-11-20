//! Starting an app the way the Start menu does: hand the shortcut, `shell:AppsFolder\<id>` or protocol URL to
//! `ShellExecuteExW`. The call returns when the shell has started the app, not when its window is up; the
//! duration measured here is the dock's own share of the click-to-launch time.

use crate::catalogue::LaunchTarget;
use crate::com::{pcwstr, wide, ComGuard};
use std::io;
use std::time::{Duration, Instant};
use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

/// Starts `target` and returns how long the `ShellExecuteExW` call took.
pub fn launch(target: &LaunchTarget) -> io::Result<Duration> {
    let path = wide(&target.shell_path());
    let _com = ComGuard::new();
    let mut info = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        // NOASYNC: this call may run on a short-lived thread, and the shell must not hand the work to one
        // that is about to exit. NO_UI: the dock shows its own messages, not Explorer's error boxes.
        fMask: SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
        lpFile: pcwstr(&path),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    let started = Instant::now();
    // SAFETY: `info` is fully initialised and `path` outlives the call.
    unsafe { ShellExecuteExW(&mut info) }.map_err(io::Error::other)?;
    Ok(started.elapsed())
}

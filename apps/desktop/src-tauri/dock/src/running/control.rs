//! Acting on a window: bring it forward, minimise it, close it.
//!
//! Windows only lets the process that received the last input change the foreground window. A click on the
//! dock is that input, so `SetForegroundWindow` usually works at once; when it does not, the thread's input is
//! attached to the current foreground window's thread for the moment it takes, which is the sanctioned way to
//! pass the check. Nothing here sends fake key presses.

use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, BringWindowToTop, FlashWindowEx, GetForegroundWindow, GetWindowThreadProcessId, IsIconic,
    IsWindow, PostMessageW, SetForegroundWindow, ShowWindow, ShowWindowAsync, ASFW_ANY, FLASHWINFO, FLASHW_ALL,
    FLASHW_TIMERNOFG, SW_MINIMIZE, SW_RESTORE, WM_CLOSE,
};

/// How many times a refused foreground request flashes the taskbar button, the standard "this wants you".
const FLASH_COUNT: u32 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// The window is the foreground window now.
    Focused,
    /// Windows refused the foreground change; the window was flashed instead.
    Flashed,
    /// The window no longer exists.
    Gone,
}

fn handle(hwnd: isize) -> HWND {
    HWND(hwnd as *mut _)
}

pub fn exists(hwnd: isize) -> bool {
    // SAFETY: IsWindow accepts any value and answers false for a stale one.
    unsafe { IsWindow(Some(handle(hwnd))).as_bool() }
}

/// Restores a minimised window and brings it to the front with keyboard focus.
pub fn activate(hwnd: isize) -> Outcome {
    let target = handle(hwnd);
    if !exists(hwnd) {
        return Outcome::Gone;
    }
    // SAFETY: window calls with a handle that was just checked; a handle that goes stale in between makes
    // the calls fail harmlessly.
    unsafe {
        if IsIconic(target).as_bool() {
            let _ = ShowWindow(target, SW_RESTORE);
        }
        let _ = AllowSetForegroundWindow(ASFW_ANY);
        if try_foreground(target) {
            return Outcome::Focused;
        }
        let foreground_thread = GetWindowThreadProcessId(GetForegroundWindow(), None);
        let this_thread = GetCurrentThreadId();
        let attached = foreground_thread != 0
            && foreground_thread != this_thread
            && AttachThreadInput(this_thread, foreground_thread, true).as_bool();
        let focused = try_foreground(target);
        if attached {
            let _ = AttachThreadInput(this_thread, foreground_thread, false);
        }
        if focused {
            return Outcome::Focused;
        }
        let info = FLASHWINFO {
            cbSize: size_of::<FLASHWINFO>() as u32,
            hwnd: target,
            dwFlags: FLASHW_ALL | FLASHW_TIMERNOFG,
            uCount: FLASH_COUNT,
            dwTimeout: 0,
        };
        let _ = FlashWindowEx(&info);
    }
    Outcome::Flashed
}

/// # Safety
/// `target` must be a window handle; a stale one only makes the calls fail.
unsafe fn try_foreground(target: HWND) -> bool {
    // SAFETY: plain window calls.
    unsafe {
        let _ = BringWindowToTop(target);
        let _ = SetForegroundWindow(target);
        let _ = SetFocus(Some(target));
        GetForegroundWindow() == target
    }
}

/// Minimises without waiting for the window's thread, so a hung app cannot freeze the dock.
pub fn minimise(hwnd: isize) {
    // SAFETY: ShowWindowAsync only posts a request.
    unsafe {
        let _ = ShowWindowAsync(handle(hwnd), SW_MINIMIZE);
    }
}

/// Asks the window to close, the way its close button does; the app may ask to save first.
pub fn close(hwnd: isize) -> bool {
    // SAFETY: posting a message to a window handle; a stale handle makes it fail.
    unsafe { PostMessageW(Some(handle(hwnd)), WM_CLOSE, WPARAM(0), LPARAM(0)).is_ok() }
}

/// A click on a running app's dock item: restore and focus, or minimise if it is already focused.
pub fn toggle(hwnd: isize, minimised: bool, focused: bool) -> Outcome {
    if !minimised && focused && exists(hwnd) {
        minimise(hwnd);
        return Outcome::Focused;
    }
    activate(hwnd)
}

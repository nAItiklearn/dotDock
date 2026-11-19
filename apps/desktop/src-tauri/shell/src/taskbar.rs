//! The native Windows taskbar: find it, show it, read and set auto-hide. Same behaviour as the
//! taskbar helpers in `tools/lib/WinShell.psm1`, so the app and the panic script restore alike.
//! The dock hides the taskbar; every exit path must be able to bring it back with `show_all`.

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::UI::Shell::{SHAppBarMessage, ABM_GETSTATE, ABM_SETSTATE, APPBARDATA};
use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, FindWindowW, IsWindowVisible, ShowWindow, SW_SHOW};

/// `ABS_AUTOHIDE` and `ABS_ALWAYSONTOP` from shellapi.h (not exported by the windows crate).
const ABS_AUTOHIDE: u32 = 0x1;
const ABS_ALWAYSONTOP: u32 = 0x2;

const PRIMARY_CLASS: PCWSTR = w!("Shell_TrayWnd");
const SECONDARY_CLASS: PCWSTR = w!("Shell_SecondaryTrayWnd");

/// The primary taskbar and the taskbar on every other monitor.
pub fn windows() -> Vec<HWND> {
    let mut out = Vec::new();
    // SAFETY: plain window lookups by class name; null results are filtered out.
    unsafe {
        if let Ok(primary) = FindWindowW(PRIMARY_CLASS, PCWSTR::null()) {
            if !primary.is_invalid() {
                out.push(primary);
            }
        }
        let mut after = HWND::default();
        while let Ok(next) = FindWindowExW(None, Some(after), SECONDARY_CLASS, PCWSTR::null()) {
            if next.is_invalid() {
                break;
            }
            out.push(next);
            after = next;
        }
    }
    out
}

/// True when every taskbar is visible; `None` when Explorer has no taskbar right now.
pub fn is_visible() -> Option<bool> {
    let bars = windows();
    if bars.is_empty() {
        return None;
    }
    // SAFETY: IsWindowVisible on handles just returned by FindWindow.
    Some(bars.iter().all(|&h| unsafe { IsWindowVisible(h) }.as_bool()))
}

/// Shows every taskbar. Safe to call at any time, any number of times.
pub fn show_all() {
    for bar in windows() {
        // SAFETY: ShowWindow on a taskbar handle; the return value is the previous visibility.
        unsafe {
            let _ = ShowWindow(bar, SW_SHOW);
        }
    }
}

fn appbar_data() -> APPBARDATA {
    APPBARDATA {
        cbSize: std::mem::size_of::<APPBARDATA>() as u32,
        // SAFETY: lookup by class name; an invalid handle is acceptable to SHAppBarMessage here.
        hWnd: unsafe { FindWindowW(PRIMARY_CLASS, PCWSTR::null()) }.unwrap_or_default(),
        ..Default::default()
    }
}

/// True when "Automatically hide the taskbar" is on.
pub fn auto_hide() -> bool {
    let mut data = appbar_data();
    // SAFETY: ABM_GETSTATE only reads cbSize and hWnd.
    let state = unsafe { SHAppBarMessage(ABM_GETSTATE, &mut data) } as u32;
    state & ABS_AUTOHIDE != 0
}

pub fn set_auto_hide(on: bool) {
    let mut data = appbar_data();
    data.lParam = LPARAM(if on { ABS_AUTOHIDE } else { ABS_ALWAYSONTOP } as isize);
    // SAFETY: ABM_SETSTATE reads cbSize, hWnd and lParam from our struct.
    unsafe {
        SHAppBarMessage(ABM_SETSTATE, &mut data);
    }
}

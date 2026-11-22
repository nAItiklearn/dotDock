//! Which top-level windows are on a taskbar, and what the shell knows about each.

use super::{RawWindow, NOT_APP_CLASSES};
use crate::com::{from_wide, store_string};
use std::collections::HashMap;
use windows::core::BOOL;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, TRUE};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetAncestor, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowLongW, GetWindowTextLengthW,
    GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, GA_ROOTOWNER, GWL_EXSTYLE, GW_OWNER,
    WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

const CLASS_BUFFER: usize = 128;
const PATH_BUFFER: usize = 1024;

/// True when DWM hides the window: on another virtual desktop, or a suspended Store app.
fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    // SAFETY: DwmGetWindowAttribute writes one `u32` into the buffer we give it.
    let ok = unsafe {
        DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, std::ptr::from_mut(&mut cloaked).cast(), size_of::<u32>() as u32)
    };
    ok.is_ok() && cloaked != 0
}

fn class_name(hwnd: HWND) -> String {
    let mut buffer = [0u16; CLASS_BUFFER];
    // SAFETY: plain query into a buffer we own.
    let len = unsafe { GetClassNameW(hwnd, &mut buffer) };
    from_wide(&buffer[..len.max(0) as usize])
}

fn title(hwnd: HWND) -> String {
    // SAFETY: plain queries; the buffer is sized from the reported length.
    unsafe {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return String::new();
        }
        let mut buffer = vec![0u16; len as usize + 1];
        let copied = GetWindowTextW(hwnd, &mut buffer).max(0) as usize;
        String::from_utf16_lossy(&buffer[..copied])
    }
}

/// The shell's own rule for a taskbar button, cheap checks only: visible, not a tool window (unless it asks to
/// be on the taskbar), and not owned by another window (unless it asks to be on the taskbar).
pub fn passes_style_rules(hwnd: HWND) -> bool {
    // SAFETY: plain queries on a window handle; a stale handle just fails the checks.
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() {
            return false;
        }
        let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if ex & WS_EX_APPWINDOW.0 != 0 {
            return true;
        }
        if ex & (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) != 0 {
            return false;
        }
        !GetWindow(hwnd, GW_OWNER).is_ok_and(|owner| !owner.is_invalid())
    }
}

/// A window that is on the taskbar: the style rules, not cloaked, a title, and not one of ours or the shell's.
pub fn is_taskbar_window(hwnd: HWND, own_pids: &[u32]) -> bool {
    if !passes_style_rules(hwnd) || is_cloaked(hwnd) {
        return false;
    }
    let mut pid = 0u32;
    // SAFETY: plain query.
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if own_pids.contains(&pid) || title(hwnd).trim().is_empty() {
        return false;
    }
    let class = class_name(hwnd);
    !NOT_APP_CLASSES.contains(&class.as_str())
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: `lparam` is the address of the `Vec` that `top_level_windows` keeps alive for the whole call.
    let out = unsafe { &mut *(lparam.0 as *mut Vec<HWND>) };
    out.push(hwnd);
    TRUE
}

/// Every top-level window, topmost first.
fn top_level_windows() -> Vec<HWND> {
    let mut out: Vec<HWND> = Vec::new();
    // SAFETY: the callback only runs during this call and `out` outlives it.
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(std::ptr::from_mut(&mut out) as isize));
    }
    out
}

/// The windows that qualify, topmost first, with no per-window shell lookups yet.
pub fn candidates(own_pids: &[u32]) -> Vec<HWND> {
    top_level_windows().into_iter().filter(|&h| is_taskbar_window(h, own_pids)).collect()
}

/// Path of the program a process runs.
fn process_path(pid: u32) -> Option<String> {
    // SAFETY: the handle is closed on every path; the buffer is ours.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; PATH_BUFFER];
        let mut len = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buffer.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(process);
        ok.ok()?;
        Some(String::from_utf16_lossy(&buffer[..len as usize]))
    }
}

fn window_aumid(hwnd: HWND) -> Option<String> {
    // SAFETY: COM property store of a window; needs COM on this thread (the worker has it).
    let store: IPropertyStore = unsafe { SHGetPropertyStoreForWindow(hwnd) }.ok()?;
    store_string(&store, &PKEY_AppUserModel_ID)
}

/// Remembers which program owns which process, so a list refresh opens a process only the first time it sees it.
#[derive(Default)]
pub struct ProcessCache {
    paths: HashMap<u32, Option<String>>,
}

impl ProcessCache {
    fn path(&mut self, pid: u32) -> Option<String> {
        if let Some(Some(known)) = self.paths.get(&pid) {
            return Some(known.clone());
        }
        // A process that has only just started can refuse the query; asking again on the next refresh keeps its
        // windows from staying unmatched (a second, unpinned icon beside the pinned app) for its whole life.
        let found = process_path(pid);
        self.paths.insert(pid, found.clone());
        found
    }
}

/// The taskbar windows with their AppUserModelID and program, topmost first. Needs COM on this thread.
pub fn list(own_pids: &[u32], cache: &mut ProcessCache) -> Vec<RawWindow> {
    // SAFETY: plain query.
    let foreground = unsafe { GetForegroundWindow() };
    // SAFETY: plain query; an invalid foreground window yields an invalid root owner.
    let focused_owner = unsafe { GetAncestor(foreground, GA_ROOTOWNER) };
    let windows: Vec<RawWindow> = candidates(own_pids)
        .into_iter()
        .map(|hwnd| {
            let mut pid = 0u32;
            // SAFETY: plain queries.
            let minimized = unsafe {
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                IsIconic(hwnd).as_bool()
            };
            RawWindow {
                hwnd: hwnd.0 as isize,
                title: title(hwnd),
                pid,
                aumid: window_aumid(hwnd),
                exe: cache.path(pid),
                minimized,
                focused: hwnd == foreground || (!focused_owner.is_invalid() && hwnd == focused_owner),
            }
        })
        .collect();
    // Forget processes that no longer own a window, so the cache cannot hand a reused pid the old path.
    cache.paths.retain(|pid, _| windows.iter().any(|w| w.pid == *pid));
    windows
}

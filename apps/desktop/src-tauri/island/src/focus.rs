//! Brings the terminal that hosts a session to the front.
//!
//! Windows Terminal and VS Code run many sessions inside one process, so the exact tab cannot be chosen from
//! outside; the right window is. Method: walk up from Claude Code's process to the first ancestor that owns a
//! visible window (Windows Terminal, Code, ...), preferring a window whose title mentions the project.

use crate::process::{ancestry, is_alive, table, ProcessEntry};
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FocusOutcome {
    Focused,
    WindowNotFound,
    SessionEnded,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WindowInfo {
    pub hwnd: isize,
    pub pid: u32,
    pub title: String,
}

/// Executables that host terminals; used when the process chain leads nowhere (a detached or elevated shell).
const TERMINAL_HOSTS: [&str; 7] = [
    "windowsterminal.exe",
    "code.exe",
    "cursor.exe",
    "wezterm-gui.exe",
    "alacritty.exe",
    "conhost.exe",
    "windsurf.exe",
];
const MAX_ANCESTORS: usize = 12;

fn title_matches(window: &WindowInfo, project: &str) -> bool {
    !project.is_empty() && window.title.to_lowercase().contains(&project.to_lowercase())
}

/// Chooses the window to focus. `windows` is in z-order (topmost first). Pure, so it is tested without a desktop.
pub fn choose_window(chain: &[u32], hosts: &[u32], windows: &[WindowInfo], project: &str) -> Option<isize> {
    let pick =
        |owned: Vec<&WindowInfo>| owned.iter().find(|w| title_matches(w, project)).or(owned.first()).map(|w| w.hwnd);
    for pid in chain {
        let owned: Vec<&WindowInfo> = windows.iter().filter(|w| w.pid == *pid).collect();
        if let Some(hwnd) = pick(owned) {
            return Some(hwnd);
        }
    }
    let hosted: Vec<&WindowInfo> = windows.iter().filter(|w| hosts.contains(&w.pid)).collect();
    hosted.iter().find(|w| title_matches(w, project)).map(|w| w.hwnd)
}

fn host_pids(table: &[ProcessEntry]) -> Vec<u32> {
    table.iter().filter(|p| TERMINAL_HOSTS.contains(&p.exe.to_lowercase().as_str())).map(|p| p.pid).collect()
}

/// Focuses the window hosting the session whose Claude Code process is `pid`.
pub fn focus_session(pid: Option<u32>, pid_start: Option<u64>, project: &str) -> FocusOutcome {
    if let Some(pid) = pid {
        if !is_alive(pid, pid_start) {
            return FocusOutcome::SessionEnded;
        }
    }
    let processes = table();
    let chain = pid.map(|p| ancestry(&processes, p, MAX_ANCESTORS)).unwrap_or_default();
    let windows = imp::visible_windows();
    match choose_window(&chain, &host_pids(&processes), &windows, project) {
        Some(hwnd) => {
            imp::bring_to_front(hwnd);
            FocusOutcome::Focused
        }
        None => FocusOutcome::WindowNotFound,
    }
}

/// The window `focus_session` would raise, without raising it.
pub fn find_window(pid: u32, project: &str) -> Option<WindowInfo> {
    let processes = table();
    let chain = ancestry(&processes, pid, MAX_ANCESTORS);
    let windows = imp::visible_windows();
    let hwnd = choose_window(&chain, &host_pids(&processes), &windows, project)?;
    windows.into_iter().find(|w| w.hwnd == hwnd)
}

#[cfg(windows)]
mod imp {
    use super::WindowInfo;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, TRUE};
    use windows::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYEVENTF_KEYUP, VK_MENU};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FlashWindowEx, GetForegroundWindow, GetWindow, GetWindowLongW, GetWindowTextLengthW,
        GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow,
        FLASHWINFO, FLASHW_ALL, FLASHW_TIMERNOFG, GWL_EXSTYLE, GW_OWNER, SW_RESTORE, WS_EX_TOOLWINDOW,
    };

    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
        // SAFETY: `lparam` is the address of the `Vec` that `visible_windows` keeps alive for the whole EnumWindows call.
        let out = unsafe { &mut *(lparam.0 as *mut Vec<WindowInfo>) };
        // SAFETY: plain queries on a window handle handed to us by EnumWindows.
        unsafe {
            let tool = (GetWindowLongW(hwnd, GWL_EXSTYLE) as u32) & WS_EX_TOOLWINDOW.0 != 0;
            let owned = GetWindow(hwnd, GW_OWNER).is_ok_and(|owner| !owner.is_invalid());
            let len = GetWindowTextLengthW(hwnd);
            if IsWindowVisible(hwnd).as_bool() && !tool && !owned && len > 0 {
                let mut buffer = vec![0u16; len as usize + 1];
                let copied = GetWindowTextW(hwnd, &mut buffer).max(0) as usize;
                let mut pid = 0u32;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                out.push(WindowInfo { hwnd: hwnd.0 as isize, pid, title: String::from_utf16_lossy(&buffer[..copied]) });
            }
        }
        TRUE
    }

    /// Top-level, visible, titled, non-tool windows, topmost first.
    pub fn visible_windows() -> Vec<WindowInfo> {
        let mut out: Vec<WindowInfo> = Vec::new();
        // SAFETY: the callback only runs during this call and `out` outlives it.
        unsafe {
            let _ = EnumWindows(Some(collect), LPARAM(std::ptr::from_mut(&mut out) as isize));
        }
        out
    }

    pub fn bring_to_front(hwnd: isize) {
        let hwnd = HWND(hwnd as *mut _);
        // SAFETY: window calls with a handle from EnumWindows; a stale handle just makes them fail harmlessly.
        unsafe {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            let _ = SetForegroundWindow(hwnd);
            if GetForegroundWindow() != hwnd {
                // Windows only lets the process that received the last input steal focus; a synthetic Alt press
                // counts as input and is the established way to pass that check.
                keybd_event(VK_MENU.0 as u8, 0, Default::default(), 0);
                keybd_event(VK_MENU.0 as u8, 0, KEYEVENTF_KEYUP, 0);
                let _ = SetForegroundWindow(hwnd);
            }
            if GetForegroundWindow() != hwnd {
                let info = FLASHWINFO {
                    cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
                    hwnd,
                    dwFlags: FLASHW_ALL | FLASHW_TIMERNOFG,
                    uCount: 3,
                    dwTimeout: 0,
                };
                let _ = FlashWindowEx(&info);
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::WindowInfo;
    pub fn visible_windows() -> Vec<WindowInfo> {
        Vec::new()
    }
    pub fn bring_to_front(_hwnd: isize) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(hwnd: isize, pid: u32, title: &str) -> WindowInfo {
        WindowInfo { hwnd, pid, title: title.into() }
    }

    #[test]
    fn nearest_ancestor_with_a_window_wins() {
        let windows = [win(1, 50, "Other"), win(2, 20, "Windows Terminal"), win(3, 10, "Explorer")];
        assert_eq!(choose_window(&[30, 20, 10], &[], &windows, "dotDock"), Some(2));
    }

    #[test]
    fn a_title_mentioning_the_project_beats_z_order_within_one_process() {
        let windows = [win(1, 20, "krova - Visual Studio Code"), win(2, 20, "dotDock - Visual Studio Code")];
        assert_eq!(choose_window(&[30, 20], &[], &windows, "dotdock"), Some(2));
        assert_eq!(choose_window(&[30, 20], &[], &windows, "unrelated"), Some(1), "falls back to the topmost");
    }

    #[test]
    fn known_terminal_hosts_are_only_used_when_the_title_names_the_project() {
        let windows = [win(1, 77, "Windows Terminal"), win(2, 77, "dotDock: claude")];
        assert_eq!(choose_window(&[], &[77], &windows, "dotDock"), Some(2));
        assert_eq!(choose_window(&[], &[77], &windows, "other"), None, "no guessing between unrelated windows");
        assert_eq!(choose_window(&[], &[], &windows, "dotDock"), None);
    }

    #[test]
    fn host_detection_is_case_insensitive() {
        let table = vec![
            ProcessEntry { pid: 5, parent: 1, exe: "WindowsTerminal.exe".into() },
            ProcessEntry { pid: 6, parent: 1, exe: "notepad.exe".into() },
        ];
        assert_eq!(host_pids(&table), vec![5]);
    }

    #[cfg(windows)]
    #[test]
    fn the_real_desktop_can_be_enumerated_without_focusing_anything() {
        let windows = imp::visible_windows();
        assert!(windows.iter().all(|w| w.hwnd != 0 && !w.title.is_empty()));
        assert!(focus_session(Some(u32::MAX - 5), None, "x") == FocusOutcome::SessionEnded);
    }
}

//! The dock window's Win32 state: never in the taskbar, never activated by accident, click-through except where
//! the dock draws something, always on top.
//!
//! The windowing library rewrites the extended styles on its own changes, so these bits are owned here. Every
//! writer goes through `Styles::enforce`, which recomputes the whole value from two flags, so two threads changing
//! one flag each cannot undo each other.

use super::pointer::Watched;
use crate::placement::PxRect;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    GetClientRect, GetCursorPos, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, IsWindow, SetForegroundWindow,
    SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST, SWP_NOACTIVATE, SW_HIDE, SW_SHOWNOACTIVATE,
    USER_DEFAULT_SCREEN_DPI, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};

const ALWAYS: isize = (WS_EX_TOOLWINDOW.0 | WS_EX_LAYERED.0) as isize;
const NEVER: isize = WS_EX_APPWINDOW.0 as isize;
const CLICK_THROUGH: isize = WS_EX_TRANSPARENT.0 as isize;
const NO_ACTIVATE: isize = WS_EX_NOACTIVATE.0 as isize;

fn hwnd(raw: isize) -> HWND {
    HWND(raw as *mut _)
}

/// The two things that change while the dock runs: whether clicks pass through, and whether the window may take
/// the keyboard focus (while a search field, a popover or edit mode needs keys).
pub struct Styles {
    click_through: AtomicBool,
    focusable: AtomicBool,
}

impl Default for Styles {
    fn default() -> Self {
        // A new dock lets clicks through until the cursor is over something, and never takes focus.
        Styles { click_through: AtomicBool::new(true), focusable: AtomicBool::new(false) }
    }
}

/// The extended style that has the flags applied to `current`.
fn extended_style(current: isize, click_through: bool, focusable: bool) -> isize {
    let mut style = (current | ALWAYS) & !NEVER;
    style = if click_through { style | CLICK_THROUGH } else { style & !CLICK_THROUGH };
    if focusable {
        style & !NO_ACTIVATE
    } else {
        style | NO_ACTIVATE
    }
}

impl Styles {
    pub fn set_click_through(&self, on: bool) {
        self.click_through.store(on, Ordering::Release);
    }

    pub fn set_focusable(&self, on: bool) {
        self.focusable.store(on, Ordering::Release);
    }

    /// Writes the styles for the current flags to `window`.
    pub fn enforce(&self, window: isize) {
        let h = hwnd(window);
        // SAFETY: style reads and writes on the dock window; a destroyed handle reads 0 and the write is refused.
        unsafe {
            let current = GetWindowLongPtrW(h, GWL_EXSTYLE);
            let wanted = extended_style(
                current,
                self.click_through.load(Ordering::Acquire),
                self.focusable.load(Ordering::Acquire),
            );
            if wanted != current {
                SetWindowLongPtrW(h, GWL_EXSTYLE, wanted);
            }
        }
    }
}

pub fn show(window: isize) {
    // SAFETY: shows the dock window without activating it.
    unsafe {
        let _ = ShowWindow(hwnd(window), SW_SHOWNOACTIVATE);
    }
}

pub fn hide(window: isize) {
    // SAFETY: hides the dock window.
    unsafe {
        let _ = ShowWindow(hwnd(window), SW_HIDE);
    }
}

/// Moves and sizes the window (physical px) and keeps it above ordinary windows, without activating it.
pub fn place(window: isize, rect: PxRect) {
    // SAFETY: positions the dock window.
    unsafe {
        let _ = SetWindowPos(
            hwnd(window),
            Some(HWND_TOPMOST),
            rect.left,
            rect.top,
            rect.width(),
            rect.height(),
            SWP_NOACTIVATE,
        );
    }
}

pub fn exists(window: isize) -> bool {
    // SAFETY: IsWindow is safe on any handle value.
    unsafe { IsWindow(Some(hwnd(window))) }.as_bool()
}

/// The window's DPI scale factor (1.25 at 125 %).
pub fn scale(window: isize) -> f64 {
    // SAFETY: a DPI query on a window handle; 0 means the window is gone.
    let dpi = unsafe { GetDpiForWindow(hwnd(window)) };
    if dpi == 0 {
        1.0
    } else {
        f64::from(dpi) / f64::from(USER_DEFAULT_SCREEN_DPI)
    }
}

/// Width of the window's client area in physical px.
pub fn client_width(window: isize) -> i32 {
    let mut rect = RECT::default();
    // SAFETY: reads the client rectangle of the dock window into a RECT we own.
    unsafe {
        let _ = GetClientRect(hwnd(window), &mut rect);
    }
    rect.right - rect.left
}

/// The cursor as the dock window sees it, and the window's way of taking or refusing clicks.
pub struct DockCursor {
    window: isize,
    styles: std::sync::Arc<Styles>,
}

impl DockCursor {
    pub fn new(window: isize, styles: std::sync::Arc<Styles>) -> DockCursor {
        DockCursor { window, styles }
    }
}

impl Watched for DockCursor {
    fn cursor(&self) -> Option<(f64, f64)> {
        let mut at = windows::Win32::Foundation::POINT::default();
        let mut rect = RECT::default();
        // SAFETY: reads the cursor and the window rectangle into values we own.
        unsafe {
            GetCursorPos(&mut at).ok()?;
            GetWindowRect(hwnd(self.window), &mut rect).ok()?;
        }
        let scale = scale(self.window);
        Some((f64::from(at.x - rect.left) / scale, f64::from(at.y - rect.top) / scale))
    }

    fn take_clicks(&self, on: bool) {
        self.styles.set_click_through(!on);
        self.styles.enforce(self.window);
    }
}

/// Who had the keyboard before the dock asked for it, so it can be handed back.
#[derive(Default)]
pub struct Focus {
    previous: AtomicIsize,
}

impl Focus {
    /// The dock needs keys: allow activation and take the foreground.
    pub fn take(&self, window: isize, styles: &Styles) {
        // SAFETY: reads the foreground window and asks for it for ours; the user has just interacted with the dock.
        unsafe {
            let current = GetForegroundWindow();
            if current != hwnd(window) {
                self.previous.store(current.0 as isize, Ordering::Release);
            }
            styles.set_focusable(true);
            styles.enforce(window);
            let _ = SetForegroundWindow(hwnd(window));
        }
    }

    /// The dock is done with keys: refuse activation again and give the foreground back if it is still ours.
    pub fn give_back(&self, window: isize, styles: &Styles) {
        styles.set_focusable(false);
        styles.enforce(window);
        let previous = self.previous.swap(0, Ordering::AcqRel);
        // SAFETY: only hands the foreground on while the dock holds it, and only to a window that still exists.
        unsafe {
            if previous != 0 && exists(previous) && GetForegroundWindow() == hwnd(window) {
                let _ = SetForegroundWindow(hwnd(previous));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLAIN: isize = 0;

    #[test]
    fn the_dock_is_a_tool_window_that_never_activates_and_clicks_through() {
        let style = extended_style(PLAIN, true, false);
        assert_ne!(style & ALWAYS, 0);
        assert_ne!(style & CLICK_THROUGH, 0);
        assert_ne!(style & NO_ACTIVATE, 0);
        assert_eq!(style & NEVER, 0);
    }

    #[test]
    fn taking_clicks_and_taking_focus_are_independent() {
        assert_eq!(extended_style(PLAIN, false, false) & CLICK_THROUGH, 0);
        assert_ne!(extended_style(PLAIN, false, false) & NO_ACTIVATE, 0);
        assert_eq!(extended_style(PLAIN, true, true) & NO_ACTIVATE, 0);
        assert_ne!(extended_style(PLAIN, true, true) & CLICK_THROUGH, 0);
    }

    #[test]
    fn it_is_stable_and_removes_the_taskbar_button_style() {
        let once = extended_style(NEVER, true, false);
        assert_eq!(once & NEVER, 0, "an app window would get a taskbar button");
        assert_eq!(extended_style(once, true, false), once);
    }

    #[test]
    fn other_styles_are_left_alone() {
        let topmost = 0x8_isize;
        assert_ne!(extended_style(topmost, true, false) & topmost, 0);
    }
}

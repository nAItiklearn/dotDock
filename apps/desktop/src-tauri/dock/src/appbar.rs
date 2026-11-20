//! The app bar spike: reserving a strip of the screen so maximised windows stop at the dock.
//!
//! **Nothing in the default code path calls this.** `AppBar::register` is only called from the `appbar_probe`
//! example; the host calls `AppBar::claim` when the user turns "reserve space" on. The returned guard removes the
//! bar when dropped, so an early return or a panic cannot leave a bar registered; `Drop` also runs on the
//! unwinding path of the panic hook the app installs.

use crate::protocol::DockEdge;
use std::io;
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTOPRIMARY,
};
use windows::Win32::UI::Shell::{
    SHAppBarMessage, ABE_BOTTOM, ABE_LEFT, ABE_RIGHT, ABE_TOP, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS,
    APPBARDATA,
};
use windows::Win32::UI::WindowsAndMessaging::{
    MoveWindow, SystemParametersInfoW, SPI_GETWORKAREA, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
};

fn abe(edge: DockEdge) -> u32 {
    match edge {
        DockEdge::Bottom => ABE_BOTTOM,
        DockEdge::Top => ABE_TOP,
        DockEdge::Left => ABE_LEFT,
        DockEdge::Right => ABE_RIGHT,
    }
}

/// The strip of `monitor` along `edge`, `thickness` px deep.
pub fn strip(monitor: RECT, edge: DockEdge, thickness: i32) -> RECT {
    match edge {
        DockEdge::Bottom => RECT { top: monitor.bottom - thickness, ..monitor },
        DockEdge::Top => RECT { bottom: monitor.top + thickness, ..monitor },
        DockEdge::Left => RECT { right: monitor.left + thickness, ..monitor },
        DockEdge::Right => RECT { left: monitor.right - thickness, ..monitor },
    }
}

/// Keeps the depth the dock asked for after the system has moved the strip out of the way of other bars.
pub fn with_thickness(queried: RECT, edge: DockEdge, thickness: i32) -> RECT {
    match edge {
        DockEdge::Bottom => RECT { top: queried.bottom - thickness, ..queried },
        DockEdge::Top => RECT { bottom: queried.top + thickness, ..queried },
        DockEdge::Left => RECT { right: queried.left + thickness, ..queried },
        DockEdge::Right => RECT { left: queried.right - thickness, ..queried },
    }
}

/// A registered app bar. Removing it (and giving the screen space back) is `Drop`.
pub struct AppBar {
    hwnd: HWND,
    callback_message: u32,
    edge: DockEdge,
    rect: RECT,
}

fn data(hwnd: HWND, callback_message: u32, edge: DockEdge, rect: RECT) -> APPBARDATA {
    APPBARDATA {
        cbSize: size_of::<APPBARDATA>() as u32,
        hWnd: hwnd,
        uCallbackMessage: callback_message,
        uEdge: abe(edge),
        rc: rect,
        lParam: LPARAM(0),
    }
}

impl AppBar {
    /// Registers `hwnd` as an app bar on `edge` of its monitor, `thickness` px deep, moves the window into
    /// the strip the system grants, and returns the guard. `callback_message` receives `ABN_*` notifications.
    pub fn register(hwnd: isize, edge: DockEdge, thickness: i32, callback_message: u32) -> io::Result<AppBar> {
        let mut bar = AppBar::new(hwnd, edge, callback_message)?;
        bar.place(thickness)?;
        Ok(bar)
    }

    /// Registers `hwnd` as an app bar on `edge` of `monitor` and reserves a strip `thickness` px deep without
    /// moving the window: the dock draws on a larger sheet and only the strip under its bar is kept free.
    pub fn claim(
        hwnd: isize,
        monitor: RECT,
        edge: DockEdge,
        thickness: i32,
        callback_message: u32,
    ) -> io::Result<AppBar> {
        let mut bar = AppBar::new(hwnd, edge, callback_message)?;
        bar.reserve(monitor, thickness);
        Ok(bar)
    }

    fn new(hwnd: isize, edge: DockEdge, callback_message: u32) -> io::Result<AppBar> {
        let hwnd = HWND(hwnd as *mut _);
        let mut new = data(hwnd, callback_message, edge, RECT::default());
        // SAFETY: SHAppBarMessage with a fully initialised APPBARDATA; ABM_NEW returns TRUE on success.
        if unsafe { SHAppBarMessage(ABM_NEW, &mut new) } == 0 {
            return Err(io::Error::other("the shell refused to register the app bar"));
        }
        Ok(AppBar { hwnd, callback_message, edge, rect: RECT::default() })
    }

    /// Asks for the strip of `monitor`, lets the system adjust it for other bars and claims it. Call again to
    /// change the thickness or after a display change. Returns the strip granted.
    pub fn reserve(&mut self, monitor: RECT, thickness: i32) -> RECT {
        let mut abd = data(self.hwnd, self.callback_message, self.edge, strip(monitor, self.edge, thickness));
        // SAFETY: QUERYPOS and SETPOS read and write only the APPBARDATA we pass.
        unsafe {
            SHAppBarMessage(ABM_QUERYPOS, &mut abd);
            abd.rc = with_thickness(abd.rc, self.edge, thickness);
            SHAppBarMessage(ABM_SETPOS, &mut abd);
        }
        self.rect = abd.rc;
        abd.rc
    }

    /// Reserves the strip on the window's own monitor and moves the window into it.
    pub fn place(&mut self, thickness: i32) -> io::Result<RECT> {
        let granted = self.reserve(monitor_rect(self.hwnd)?, thickness);
        // SAFETY: moves the window that owns this bar into the strip it was granted.
        unsafe {
            MoveWindow(
                self.hwnd,
                granted.left,
                granted.top,
                granted.right - granted.left,
                granted.bottom - granted.top,
                true,
            )
            .map_err(io::Error::other)?;
        }
        Ok(granted)
    }

    /// The strip granted by the last `reserve` or `place`.
    pub fn rect(&self) -> RECT {
        self.rect
    }
}

impl Drop for AppBar {
    fn drop(&mut self) {
        let mut abd = data(self.hwnd, self.callback_message, self.edge, self.rect);
        // SAFETY: ABM_REMOVE for the bar this guard registered.
        unsafe {
            SHAppBarMessage(ABM_REMOVE, &mut abd);
        }
    }
}

fn monitor_rect(hwnd: HWND) -> io::Result<RECT> {
    let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
    // SAFETY: plain monitor query; `info.cbSize` is set.
    let ok = unsafe { GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY), &mut info) };
    if ok.as_bool() {
        Ok(info.rcMonitor)
    } else {
        Err(io::Error::other("no monitor info"))
    }
}

/// The full rectangle of the primary monitor, in physical pixels.
pub fn primary_monitor() -> io::Result<RECT> {
    let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
    // SAFETY: MonitorFromPoint with DEFAULTTOPRIMARY always returns a monitor; `info.cbSize` is set.
    let ok = unsafe { GetMonitorInfoW(MonitorFromPoint(POINT::default(), MONITOR_DEFAULTTOPRIMARY), &mut info) };
    if ok.as_bool() {
        Ok(info.rcMonitor)
    } else {
        Err(io::Error::other("no monitor info"))
    }
}

/// The primary work area: the screen minus every app bar and the taskbar.
pub fn work_area() -> io::Result<RECT> {
    let mut area = RECT::default();
    // SAFETY: SPI_GETWORKAREA fills one RECT.
    unsafe {
        SystemParametersInfoW(
            SPI_GETWORKAREA,
            0,
            Some(std::ptr::from_mut(&mut area).cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .map_err(io::Error::other)?;
    }
    Ok(area)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITOR: RECT = RECT { left: 0, top: 0, right: 1920, bottom: 1080 };

    #[test]
    fn strips_hug_their_edge() {
        let s = |edge| strip(MONITOR, edge, 80);
        assert_eq!((s(DockEdge::Bottom).top, s(DockEdge::Bottom).bottom), (1000, 1080));
        assert_eq!((s(DockEdge::Top).top, s(DockEdge::Top).bottom), (0, 80));
        assert_eq!((s(DockEdge::Left).left, s(DockEdge::Left).right), (0, 80));
        assert_eq!((s(DockEdge::Right).left, s(DockEdge::Right).right), (1840, 1920));
        assert_eq!(s(DockEdge::Bottom).left, 0);
        assert_eq!(s(DockEdge::Bottom).right, 1920);
    }

    #[test]
    fn the_depth_survives_the_system_moving_the_strip() {
        // Another bar already holds the bottom 48 px, so the system returns the strip above it.
        let queried = RECT { left: 0, top: 1000, right: 1920, bottom: 1032 };
        let kept = with_thickness(queried, DockEdge::Bottom, 80);
        assert_eq!((kept.top, kept.bottom), (952, 1032));
        let top = with_thickness(RECT { left: 0, top: 40, right: 1920, bottom: 120 }, DockEdge::Top, 80);
        assert_eq!((top.top, top.bottom), (40, 120));
        let left = with_thickness(RECT { left: 30, top: 0, right: 110, bottom: 1080 }, DockEdge::Left, 60);
        assert_eq!((left.left, left.right), (30, 90));
        let right = with_thickness(RECT { left: 1800, top: 0, right: 1890, bottom: 1080 }, DockEdge::Right, 60);
        assert_eq!((right.left, right.right), (1830, 1890));
    }
}

//! Places the overlay at desktop level and makes empty areas click-through.
//!
//! Strategy S2 (see MASTER_SPEC 8.2): a bottom-most, non-activating tool window.
//! Chosen first because it coexists with Wallpaper Engine, which owns the WorkerW layer.

use serde::Deserialize;
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::Duration;
use tauri::{PhysicalPosition, WebviewWindow};
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_BOTTOM, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

/// Cursor sampling period. Cheap (one syscall) and below one 60 Hz frame.
const CURSOR_POLL: Duration = Duration::from_millis(16);

/// A widget's hit area in CSS pixels relative to the overlay's client area.
#[derive(Deserialize, Clone, Copy, Debug)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Default)]
pub struct HitRegions(Arc<Mutex<Vec<HitRect>>>);

impl HitRegions {
    pub fn replace(&self, rects: Vec<HitRect>) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = rects;
    }

    fn contains(&self, x: f64, y: f64) -> bool {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .any(|r| x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
    }
}

/// Gives the window desktop-level behaviour: no taskbar button, never takes focus
/// from the user's apps, and sits below every normal window.
pub fn configure(window: &WebviewWindow) -> tauri::Result<()> {
    let hwnd = HWND(window.hwnd()?.0);
    // SAFETY: hwnd belongs to a live window owned by this process; we only flip style bits.
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let wanted = (ex | (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) as isize) & !(WS_EX_APPWINDOW.0 as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, wanted);
        // A failure here only means z-order is not re-asserted now; always_on_bottom keeps it.
        let _ = SetWindowPos(hwnd, Some(HWND_BOTTOM), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
    window.set_ignore_cursor_events(true)?;
    Ok(())
}

/// Turns click-through off only while the cursor is over a widget, so empty desktop
/// stays fully usable and widget shadows and hover animations are never clipped.
pub fn spawn_hit_tester(window: WebviewWindow, regions: HitRegions) -> std::io::Result<()> {
    thread::Builder::new().name("hit-test".into()).spawn(move || {
        let mut last_cursor = POINT { x: i32::MIN, y: i32::MIN };
        let mut interactive = false;
        loop {
            thread::sleep(CURSOR_POLL);
            let mut cursor = POINT::default();
            // SAFETY: GetCursorPos writes into a POINT we own.
            if unsafe { GetCursorPos(&mut cursor) }.is_err() || (cursor.x == last_cursor.x && cursor.y == last_cursor.y)
            {
                continue;
            }
            last_cursor = cursor;
            let (Ok(origin), Ok(scale)) = (window.inner_position(), window.scale_factor()) else { break };
            let PhysicalPosition { x: ox, y: oy } = origin;
            let css_x = f64::from(cursor.x - ox) / scale;
            let css_y = f64::from(cursor.y - oy) / scale;
            let over = regions.contains(css_x, css_y);
            if over != interactive && window.set_ignore_cursor_events(!over).is_ok() {
                interactive = over;
            }
        }
    })?;
    Ok(())
}

//! Places the overlay at desktop level and makes empty areas click-through.
//!
//! Strategy S2 (MASTER_SPEC 8.2, D-007): a bottom-most, non-activating tool window, which
//! coexists with Wallpaper Engine (it owns the WorkerW layer). One guard thread owns the
//! window's Win32 state directly instead of going through the windowing library's style
//! model, because that model rewrites GWL_EXSTYLE on its own changes and drops our bits.

use dotdock_shell::run_gate::RunGate;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{COLORREF, HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    MONITOR_DEFAULTTOPRIMARY,
};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetWindow, GetWindowLongPtrW, GetWindowRect, IsWindow, SetForegroundWindow,
    SetLayeredWindowAttributes, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, GW_HWNDNEXT, HWND_BOTTOM,
    LWA_ALPHA, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_SHOWNOACTIVATE, USER_DEFAULT_SCREEN_DPI,
    WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};

/// Cursor sampling period: one cheap syscall, below one 60 Hz frame.
const CURSOR_POLL: Duration = Duration::from_millis(16);
/// How often styles, z-order and monitor geometry are re-checked.
const GUARD_EVERY: Duration = Duration::from_millis(500);

/// A widget's hit area in CSS pixels relative to the overlay's client area.
#[derive(Deserialize, Clone, Copy, Debug)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Default)]
struct RegionsInner {
    rects: Mutex<Vec<HitRect>>,
    /// Bumped on every replace, so the guard re-tests a still cursor against a new layout.
    generation: AtomicU64,
}

#[derive(Clone, Default)]
pub struct HitRegions(Arc<RegionsInner>);

impl HitRegions {
    pub fn replace(&self, rects: Vec<HitRect>) {
        *self.0.rects.lock().unwrap_or_else(PoisonError::into_inner) = rects;
        self.0.generation.fetch_add(1, Ordering::Release);
    }

    fn generation(&self) -> u64 {
        self.0.generation.load(Ordering::Acquire)
    }

    fn contains(&self, x: f64, y: f64) -> bool {
        self.0
            .rects
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .any(|r| x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
    }
}

/// Raw window handle that may cross threads. Win32 window handles are process-global
/// identifiers, and every call below tolerates the window having been destroyed.
#[derive(Clone, Copy)]
pub struct Hwnd(isize);

// SAFETY: an HWND is a plain identifier, valid from any thread of the owning process.
unsafe impl Send for Hwnd {}

impl Hwnd {
    pub fn from_raw(hwnd: *mut core::ffi::c_void) -> Self {
        Self(hwnd as isize)
    }
    fn get(self) -> HWND {
        HWND(self.0 as *mut _)
    }
}

/// True while a text field in a widget (notes, to-do) has focus: only then may the overlay
/// take keyboard focus. Otherwise it never activates, so it can never steal focus from apps.
static TYPING: AtomicBool = AtomicBool::new(false);
/// Whether the cursor is outside every hit area right now. Owned by the guard thread; read by
/// `set_typing`, so asking for the keyboard never turns the whole full-screen window opaque to clicks.
static CLICK_THROUGH: AtomicBool = AtomicBool::new(true);

const WANTED: isize = (WS_EX_TOOLWINDOW.0 | WS_EX_LAYERED.0) as isize;
const NO_ACTIVATE: isize = WS_EX_NOACTIVATE.0 as isize;
const UNWANTED: isize = WS_EX_APPWINDOW.0 as isize;
const TRANSPARENT: isize = WS_EX_TRANSPARENT.0 as isize;

/// The extended style the overlay should have: desktop-level bits always, click-through outside the
/// hit areas, and activation only while something in it needs the keyboard.
fn desired_ex_style(ex: isize, click_through: bool, typing: bool) -> isize {
    let wanted = (ex | WANTED) & !UNWANTED;
    let wanted = if click_through { wanted | TRANSPARENT } else { wanted & !TRANSPARENT };
    if typing {
        wanted & !NO_ACTIVATE
    } else {
        wanted | NO_ACTIVATE
    }
}

/// Re-applies desktop-level styles, keeping the current click-through bit. Returns true if anything changed.
fn enforce_styles(hwnd: HWND, click_through: bool) -> bool {
    // SAFETY: style reads/writes on our own window; a destroyed handle just returns 0.
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let wanted = desired_ex_style(ex, click_through, TYPING.load(Ordering::Acquire));
        if wanted == ex {
            return false;
        }
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, wanted);
        // Layered without attributes is hit-tested against a stale bitmap (widgets stop taking clicks); full
        // opacity leaves the WebView's transparency alone and lets WS_EX_TRANSPARENT alone decide click-through.
        let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), u8::MAX, LWA_ALPHA);
        true
    }
}

/// Keeps the overlay below every normal window (no window sits under it in z-order).
fn enforce_bottom(hwnd: HWND) {
    // SAFETY: z-order query and move of our own window, without activating it.
    unsafe {
        let below = GetWindow(hwnd, GW_HWNDNEXT).ok();
        if below.is_some_and(|b| !b.is_invalid()) {
            let _ = SetWindowPos(hwnd, Some(HWND_BOTTOM), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }
}

/// The primary monitor's full rectangle in physical pixels.
fn primary_monitor_rect() -> Option<RECT> {
    // SAFETY: MonitorFromPoint with DEFAULTTOPRIMARY always returns a monitor; info is our struct.
    unsafe {
        let monitor = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        GetMonitorInfoW(monitor, &mut info).as_bool().then_some(info.rcMonitor)
    }
}

/// Re-fits the overlay to the primary monitor after hot-plug, docking, resolution or DPI changes.
fn enforce_geometry(hwnd: HWND) {
    let Some(target) = primary_monitor_rect() else { return };
    let mut current = RECT::default();
    // SAFETY: rect query and move of our own window.
    unsafe {
        if GetWindowRect(hwnd, &mut current).is_err() || current == target {
            return;
        }
        let _ = SetWindowPos(
            hwnd,
            None,
            target.left,
            target.top,
            target.right - target.left,
            target.bottom - target.top,
            SWP_NOZORDER | SWP_NOACTIVATE,
        );
    }
}

/// Applies desktop-level behaviour once, right after the window exists.
pub fn configure(hwnd: Hwnd) {
    // A previous window of this process may have been closed while a field had focus.
    TYPING.store(false, Ordering::Release);
    let h = hwnd.get();
    enforce_styles(h, true);
    enforce_geometry(h);
    enforce_bottom(h);
}

/// A widget text field gained or lost focus. Gaining it lets the overlay take keyboard focus
/// (the user just clicked into it); the window is pushed straight back to the bottom so it
/// never covers the user's apps while they type.
pub fn set_typing(hwnd: Hwnd, typing: bool) {
    TYPING.store(typing, Ordering::Release);
    let h = hwnd.get();
    // Only the activation bit changes here. Click-through stays exactly as the cursor guard set it, so
    // the overlay is hit-testable over its widgets and panels and nowhere else, even while it has focus.
    enforce_styles(h, CLICK_THROUGH.load(Ordering::Acquire));
    if typing {
        // SAFETY: foreground request for our own window right after the user clicked it.
        unsafe {
            let _ = SetForegroundWindow(h);
        }
    }
    enforce_bottom(h);
}

/// How far the work area (the screen less the taskbar and any docked bar) sits inside the overlay
/// window, per side, in CSS pixels. Edit-mode panels stay inside it, so no bar can cover them.
#[derive(serde::Serialize, Clone, Copy, Debug, PartialEq)]
pub struct Insets {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

fn insets_between(window: RECT, work: RECT, scale: f64) -> Insets {
    let side = |d: i32| f64::from(d.max(0)) / scale;
    Insets {
        top: side(work.top - window.top),
        right: side(window.right - work.right),
        bottom: side(window.bottom - work.bottom),
        left: side(work.left - window.left),
    }
}

/// The work-area insets of the monitor the overlay is on, read when edit mode opens.
pub fn work_area_insets(hwnd: Hwnd) -> Option<Insets> {
    let h = hwnd.get();
    let mut window = RECT::default();
    // SAFETY: queries on our own window and the monitor it is on; info is our struct.
    unsafe {
        GetWindowRect(h, &mut window).ok()?;
        let monitor = MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return None;
        }
        let dpi = GetDpiForWindow(h);
        if dpi == 0 {
            return None;
        }
        Some(insets_between(window, info.rcWork, f64::from(dpi) / f64::from(USER_DEFAULT_SCREEN_DPI)))
    }
}

/// Shows the window without activating it. Returns true if it was hidden before.
pub fn show_without_activating(hwnd: Hwnd) -> bool {
    // SAFETY: ShowWindow on our own window; the return value is the previous visibility.
    let was_visible = unsafe { ShowWindow(hwnd.get(), SW_SHOWNOACTIVATE) }.as_bool();
    !was_visible
}

/// Cursor position in the overlay's CSS pixels, from Win32 directly (no UI-thread round trip).
fn cursor_in_css(hwnd: HWND, cursor: POINT) -> Option<(f64, f64)> {
    let mut rect = RECT::default();
    // SAFETY: queries on our own window.
    let dpi = unsafe {
        GetWindowRect(hwnd, &mut rect).ok()?;
        GetDpiForWindow(hwnd)
    };
    if dpi == 0 {
        return None;
    }
    let scale = f64::from(dpi) / f64::from(USER_DEFAULT_SCREEN_DPI);
    Some((f64::from(cursor.x - rect.left) / scale, f64::from(cursor.y - rect.top) / scale))
}

/// One thread for click-through, style, z-order and geometry guards. Exits when `gate` is stopped,
/// or when the window dies.
pub fn spawn_guard(hwnd: Hwnd, regions: HitRegions, gate: RunGate) -> std::io::Result<JoinHandle<()>> {
    thread::Builder::new().name("desktop-host".into()).spawn(move || {
        let h = hwnd.get();
        let mut last_cursor = POINT { x: i32::MIN, y: i32::MIN };
        let mut last_generation = u64::MAX;
        let mut click_through = true;
        let mut last_guard = Instant::now();
        while gate.pause(CURSOR_POLL) {
            // SAFETY: IsWindow is safe on any handle value.
            if !unsafe { IsWindow(Some(h)) }.as_bool() {
                return;
            }
            if last_guard.elapsed() >= GUARD_EVERY {
                last_guard = Instant::now();
                enforce_styles(h, click_through);
                enforce_geometry(h);
                enforce_bottom(h);
            }
            let mut cursor = POINT::default();
            // SAFETY: GetCursorPos writes into a POINT we own.
            if unsafe { GetCursorPos(&mut cursor) }.is_err() {
                continue;
            }
            let generation = regions.generation();
            if cursor == last_cursor && generation == last_generation {
                continue;
            }
            last_cursor = cursor;
            last_generation = generation;
            let over = cursor_in_css(h, cursor).is_some_and(|(x, y)| regions.contains(x, y));
            if over == click_through {
                click_through = !over;
                CLICK_THROUGH.store(click_through, Ordering::Release);
                enforce_styles(h, click_through);
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyboard_focus_never_changes_click_through() {
        for click_through in [true, false] {
            let idle = desired_ex_style(0, click_through, false);
            let typing = desired_ex_style(idle, click_through, true);
            assert_eq!(idle & TRANSPARENT, typing & TRANSPARENT);
            assert_eq!(typing & TRANSPARENT != 0, click_through);
        }
    }

    #[test]
    fn activates_only_while_something_needs_the_keyboard() {
        assert_ne!(desired_ex_style(0, true, false) & NO_ACTIVATE, 0);
        assert_eq!(desired_ex_style(NO_ACTIVATE, true, true) & NO_ACTIVATE, 0);
    }

    #[test]
    fn work_area_insets_are_per_side_in_css_pixels() {
        let window = RECT { left: 0, top: 0, right: 1920, bottom: 1080 };
        let work = RECT { left: 0, top: 0, right: 1920, bottom: 1020 };
        let insets = insets_between(window, work, 1.25);
        assert_eq!(insets, Insets { top: 0.0, right: 0.0, bottom: 48.0, left: 0.0 });
        // A work area larger than the window (never expected) is not a negative inset.
        let wide = RECT { left: -10, top: -10, right: 1930, bottom: 1090 };
        assert_eq!(insets_between(window, wide, 1.0), Insets { top: 0.0, right: 0.0, bottom: 0.0, left: 0.0 });
    }

    #[test]
    fn keeps_desktop_level_bits_and_drops_the_taskbar_button() {
        let style = desired_ex_style(UNWANTED, true, true);
        assert_eq!(style & WANTED, WANTED);
        assert_eq!(style & UNWANTED, 0);
    }
}

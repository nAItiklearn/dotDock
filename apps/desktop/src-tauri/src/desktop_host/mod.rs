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
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTOPRIMARY};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetWindow, GetWindowLongPtrW, GetWindowRect, IsWindow, SetForegroundWindow, SetWindowLongPtrW,
    SetWindowPos, ShowWindow, GWL_EXSTYLE, GW_HWNDNEXT, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_NOZORDER, SW_SHOWNOACTIVATE, USER_DEFAULT_SCREEN_DPI, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
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

const WANTED: isize = (WS_EX_TOOLWINDOW.0 | WS_EX_LAYERED.0) as isize;
const NO_ACTIVATE: isize = WS_EX_NOACTIVATE.0 as isize;
const UNWANTED: isize = WS_EX_APPWINDOW.0 as isize;
const TRANSPARENT: isize = WS_EX_TRANSPARENT.0 as isize;

/// Re-applies desktop-level styles, keeping the current click-through bit. Returns true if anything changed.
fn enforce_styles(hwnd: HWND, click_through: bool) -> bool {
    // SAFETY: style reads/writes on our own window; a destroyed handle just returns 0.
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let mut wanted = (ex | WANTED) & !UNWANTED;
        wanted = if click_through { wanted | TRANSPARENT } else { wanted & !TRANSPARENT };
        wanted = if TYPING.load(Ordering::Acquire) { wanted & !NO_ACTIVATE } else { wanted | NO_ACTIVATE };
        if wanted == ex {
            return false;
        }
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, wanted);
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
    // Click-through is off while the cursor is over the widget being typed into.
    enforce_styles(h, false);
    if typing {
        // SAFETY: foreground request for our own window right after the user clicked it.
        unsafe {
            let _ = SetForegroundWindow(h);
        }
    }
    enforce_bottom(h);
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
                enforce_styles(h, click_through);
            }
        }
    })
}

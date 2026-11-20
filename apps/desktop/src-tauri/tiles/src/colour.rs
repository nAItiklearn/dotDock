//! Colour picker: the pixel under the cursor, anywhere on screen, at physical pixels (so a 150 % display is read
//! pixel for pixel), with a magnifier square around it.
//!
//! Picking exists only between `pick_start` and the click (or Escape, right click, or the safety timeout). In
//! that time one thread owns two low-level hooks, so the click that picks the colour is swallowed and does not
//! press whatever is under the cursor, and a timer samples the screen about 30 times a second. Outside picking
//! there is no thread and no hook.

use crate::emit::{lock, shared, Emitter, Shared};
use crate::paths;
use crate::protocol::{ColourPickerState, Sample, TileData};
use crate::screenshots::{desktop_bounds, grab_square};
use std::cell::Cell;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows::Win32::UI::Input::KeyboardAndMouse::VK_ESCAPE;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetCursorPos, GetMessageW, KillTimer, PeekMessageW, PostThreadMessageW, SetTimer,
    SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, KBDLLHOOKSTRUCT, MSG, PM_NOREMOVE, WH_KEYBOARD_LL,
    WH_MOUSE_LL, WM_KEYDOWN, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_TIMER, WM_USER,
};

/// Side of the magnifier square, in pixels. Odd, so the picked pixel is its centre.
pub const LOUPE_SIDE: i32 = 9;
/// Samples per second while picking.
const SAMPLE_INTERVAL_MS: u32 = 33;
/// A pick that nobody finishes ends by itself, so the mouse is never held for long.
const PICK_TIMEOUT: Duration = Duration::from_secs(60);
/// Colours remembered between runs.
const HISTORY_LEN: usize = 12;

/// `#RRGGBB` for pixel bytes in BGRA order.
fn hex_of_bgra(p: &[u8]) -> String {
    format!("#{:02X}{:02X}{:02X}", p[2], p[1], p[0])
}

/// Top-left corner of a `side` square centred on `(x, y)`, moved inward so the square stays on the desktop.
fn loupe_origin(x: i32, y: i32, side: i32, desktop: (i32, i32, i32, i32)) -> (i32, i32) {
    let (dx, dy, dw, dh) = desktop;
    let half = side / 2;
    ((x - half).clamp(dx, (dx + dw - side).max(dx)), (y - half).clamp(dy, (dy + dh - side).max(dy)))
}

/// True for `#RRGGBB`.
pub fn is_hex_colour(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Picking,
    /// The button went down on the target colour; its release is swallowed too.
    Clicked,
    Picked,
    Cancelled,
}

thread_local! {
    static PHASE: Cell<Phase> = const { Cell::new(Phase::Picking) };
}

fn end_loop() {
    // SAFETY: posts WM_QUIT to the calling thread's own queue.
    let _ = unsafe { PostThreadMessageW(GetCurrentThreadId(), WM_QUIT, WPARAM(0), LPARAM(0)) };
}

unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        match wparam.0 as u32 {
            WM_LBUTTONDOWN => {
                PHASE.with(|p| p.set(Phase::Clicked));
                return LRESULT(1);
            }
            WM_LBUTTONUP if PHASE.with(Cell::get) == Phase::Clicked => {
                PHASE.with(|p| p.set(Phase::Picked));
                end_loop();
                return LRESULT(1);
            }
            WM_RBUTTONDOWN => {
                PHASE.with(|p| p.set(Phase::Cancelled));
                return LRESULT(1);
            }
            WM_RBUTTONUP if PHASE.with(Cell::get) == Phase::Cancelled => {
                end_loop();
                return LRESULT(1);
            }
            _ => {}
        }
    }
    // SAFETY: passes the event on unchanged.
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && wparam.0 as u32 == WM_KEYDOWN {
        // SAFETY: for WH_KEYBOARD_LL, lparam points to a KBDLLHOOKSTRUCT.
        let key = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        if key.vkCode == u32::from(VK_ESCAPE.0) {
            PHASE.with(|p| p.set(Phase::Cancelled));
            end_loop();
            return LRESULT(1);
        }
    }
    // SAFETY: passes the event on unchanged.
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

/// What is on screen at the cursor: the position, the magnifier and the centre colour.
fn read_cursor() -> Option<(Sample, Vec<String>)> {
    let mut point = POINT::default();
    // SAFETY: writes the point.
    unsafe { GetCursorPos(&mut point) }.ok()?;
    let (ox, oy) = loupe_origin(point.x, point.y, LOUPE_SIDE, desktop_bounds());
    let pixels = grab_square(ox, oy, LOUPE_SIDE).ok()?;
    let loupe: Vec<String> = pixels.as_chunks::<4>().0.iter().map(|p| hex_of_bgra(p)).collect();
    let centre =
        ((point.y - oy).clamp(0, LOUPE_SIDE - 1) * LOUPE_SIDE + (point.x - ox).clamp(0, LOUPE_SIDE - 1)) as usize;
    Some((Sample { x: point.x, y: point.y, hex: loupe[centre].clone() }, loupe))
}

pub struct ColourPicker {
    emitter: Emitter,
    history_file: PathBuf,
    state: Shared<ColourPickerState>,
    thread: Mutex<Option<JoinHandle<()>>>,
    thread_id: AtomicU32,
}

impl ColourPicker {
    pub fn new(history_file: PathBuf, emitter: Emitter) -> Self {
        let history = paths::read_json::<Vec<String>>(&history_file)
            .unwrap_or_default()
            .into_iter()
            .filter(|h| is_hex_colour(h))
            .take(HISTORY_LEN)
            .collect();
        let state = ColourPickerState { picking: false, current: None, loupe: Vec::new(), history };
        Self { emitter, history_file, state: shared(state), thread: Mutex::new(None), thread_id: AtomicU32::new(0) }
    }

    pub fn state(&self) -> ColourPickerState {
        lock(&self.state).clone()
    }

    /// Leaving the tile ends any pick in progress.
    pub fn stop(&self) {
        self.cancel();
    }

    pub fn cancel(&self) {
        let id = self.thread_id.load(Ordering::SeqCst);
        if id != 0 {
            // SAFETY: asks the picking thread to leave its message loop.
            let _ = unsafe { PostThreadMessageW(id, WM_QUIT, WPARAM(0), LPARAM(0)) };
        }
        let join = lock(&self.thread).take();
        if let Some(j) = join {
            let _ = j.join();
        }
    }

    pub fn start_picking(&self) -> Result<(), String> {
        let mut slot = lock(&self.thread);
        if slot.as_ref().is_some_and(|j| !j.is_finished()) {
            return Ok(());
        }
        let (state, emitter, file, thread_id) =
            (self.state.clone(), self.emitter.clone(), self.history_file.clone(), &self.thread_id);
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<u32, String>>();
        let join = thread::Builder::new()
            .name("tiles-colour".to_owned())
            .spawn(move || {
                // SAFETY: only affects this thread; hooks and the timer are removed before the thread ends.
                unsafe {
                    SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
                    PHASE.with(|p| p.set(Phase::Picking));
                    let instance = GetModuleHandleW(None).unwrap_or_default();
                    let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), Some(instance.into()), 0);
                    let keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), Some(instance.into()), 0);
                    let (mouse, keyboard) = match (mouse, keyboard) {
                        (Ok(m), Ok(k)) => (m, k),
                        (m, k) => {
                            // One hook may have been installed; never leave it behind.
                            for hook in [m, k].into_iter().flatten() {
                                let _ = UnhookWindowsHookEx(hook);
                            }
                            let _ = ready_tx.send(Err("Windows would not start the colour picker".to_owned()));
                            return;
                        }
                    };
                    let timer = SetTimer(None, 0, SAMPLE_INTERVAL_MS, None);
                    // Creates this thread's message queue, so a cancel posted at once is not lost.
                    let mut probe = MSG::default();
                    let _ = PeekMessageW(&mut probe, None, WM_USER, WM_USER, PM_NOREMOVE);
                    {
                        let mut s = lock(&state);
                        s.picking = true;
                        s.current = None;
                        s.loupe.clear();
                    }
                    let _ = ready_tx.send(Ok(GetCurrentThreadId()));
                    emitter.emit(TileData::ColourPicker(lock(&state).clone()));

                    let deadline = Instant::now() + PICK_TIMEOUT;
                    let mut last: Option<Sample> = None;
                    let mut msg = MSG::default();
                    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                        if msg.message == WM_TIMER {
                            if Instant::now() >= deadline {
                                PHASE.with(|p| p.set(Phase::Cancelled));
                                break;
                            }
                            if let Some((sample, loupe)) = read_cursor() {
                                if last.as_ref() != Some(&sample) {
                                    last = Some(sample.clone());
                                    let snapshot = {
                                        let mut s = lock(&state);
                                        s.current = Some(sample);
                                        s.loupe = loupe;
                                        s.clone()
                                    };
                                    emitter.emit(TileData::ColourPicker(snapshot));
                                }
                            }
                            continue;
                        }
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                    if timer != 0 {
                        let _ = KillTimer(None, timer);
                    }
                    let _ = UnhookWindowsHookEx(mouse);
                    let _ = UnhookWindowsHookEx(keyboard);
                }
                let picked = (PHASE.with(Cell::get) == Phase::Picked).then(|| last_hex(&state)).flatten();
                let snapshot = {
                    let mut s = lock(&state);
                    s.picking = false;
                    s.loupe.clear();
                    if let Some(hex) = picked {
                        s.history.retain(|h| *h != hex);
                        s.history.insert(0, hex);
                        s.history.truncate(HISTORY_LEN);
                    }
                    s.clone()
                };
                // The history is a convenience; a failed write must not disturb the pick.
                let _ = paths::write_json(&file, &snapshot.history);
                emitter.emit(TileData::ColourPicker(snapshot));
            })
            .map_err(|e| format!("could not start the colour picker: {e}"))?;
        let started =
            ready_rx.recv_timeout(Duration::from_secs(3)).map_err(|_| "the colour picker did not start".to_owned())?;
        match started {
            Ok(id) => {
                thread_id.store(id, Ordering::SeqCst);
                *slot = Some(join);
                Ok(())
            }
            Err(e) => {
                let _ = join.join();
                Err(e)
            }
        }
    }
}

fn last_hex(state: &Shared<ColourPickerState>) -> Option<String> {
    lock(state).current.as_ref().map(|c| c.hex.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DESKTOP: (i32, i32, i32, i32) = (0, 0, 1920, 1080);

    #[test]
    fn bgra_bytes_become_a_hex_colour() {
        assert_eq!(hex_of_bgra(&[0x10, 0x20, 0xFF, 0]), "#FF2010");
    }

    #[test]
    fn the_magnifier_stays_on_the_desktop() {
        assert_eq!(loupe_origin(500, 500, 9, DESKTOP), (496, 496));
        assert_eq!(loupe_origin(0, 0, 9, DESKTOP), (0, 0));
        assert_eq!(loupe_origin(1919, 1079, 9, DESKTOP), (1911, 1071));
        assert_eq!(loupe_origin(-100, 5, 9, (-1920, 0, 3840, 1080)), (-104, 1));
    }

    #[test]
    fn only_six_digit_hex_is_a_colour() {
        assert!(is_hex_colour("#A1b2C3"));
        for bad in ["A1B2C3", "#A1B2C", "#A1B2C3D", "#GGGGGG", "", "#12345é"] {
            assert!(!is_hex_colour(bad), "{bad}");
        }
    }

    #[test]
    fn a_pick_can_be_started_and_cancelled_without_leaving_hooks_behind() {
        let dir = tempfile::tempdir().unwrap();
        let picker = ColourPicker::new(dir.path().join("c.json"), Emitter::new(|_| {}));
        picker.start_picking().unwrap();
        assert!(picker.state().picking);
        picker.cancel();
        assert!(!picker.state().picking);
        // A second pick works after the first ended.
        picker.start_picking().unwrap();
        picker.cancel();
    }

    #[test]
    fn the_cursor_pixel_can_be_read() {
        // SAFETY: only changes this thread's DPI mode.
        unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
        let (sample, loupe) = read_cursor().expect("a sample");
        assert!(is_hex_colour(&sample.hex));
        assert_eq!(loupe.len(), (LOUPE_SIDE * LOUPE_SIDE) as usize);
    }
}

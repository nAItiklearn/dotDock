//! Cursor awareness for a window that is click-through except where the dock draws something.
//!
//! A click-through window gets no mouse events, so the cursor is read by a thread of its own: a few syscalls per
//! tick, fast while the cursor is near anything the dock cares about and slow while it is far away, and none
//! at all while the dock is frozen. The dock UI reports its interactive rectangles (`dock_set_regions`, CSS px
//! relative to the window); the poller turns the cursor into "inside or outside" and tells the window (take
//! clicks, or let them through) and the UI (`dock://pointer`).

use crate::protocol::Rect;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

/// Tick while the cursor is near the dock, and while it is far away. A flick across the screen at 3000 px/s moves
/// 192 px in one far tick, less than `NEAR_DISTANCE`, so the pointer is always seen before it arrives.
pub const NEAR_TICK: Duration = Duration::from_millis(16);
pub const FAR_TICK: Duration = Duration::from_millis(64);
/// Cursor within this many CSS px of a region counts as near.
const NEAR_DISTANCE: f64 = 240.0;

/// The rectangles that take the pointer, as the UI last reported them.
#[derive(Default)]
pub struct Regions {
    rects: Mutex<Vec<Rect>>,
}

impl Regions {
    pub fn replace(&self, rects: Vec<Rect>) {
        *self.rects.lock().unwrap_or_else(PoisonError::into_inner) = rects;
    }

    fn snapshot(&self) -> Vec<Rect> {
        self.rects.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }
}

fn contains(rect: &Rect, x: f64, y: f64) -> bool {
    x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
}

fn near(rect: &Rect, x: f64, y: f64) -> bool {
    contains(
        &Rect {
            x: rect.x - NEAR_DISTANCE,
            y: rect.y - NEAR_DISTANCE,
            w: rect.w + 2.0 * NEAR_DISTANCE,
            h: rect.h + 2.0 * NEAR_DISTANCE,
        },
        x,
        y,
    )
}

/// What one look at the cursor means.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Reading {
    /// The cursor is inside a region.
    pub inside: bool,
    /// The cursor is far from every region, so the next look can wait.
    pub far: bool,
}

/// Reads the cursor (CSS px relative to the window) against the regions.
pub fn read(rects: &[Rect], x: f64, y: f64) -> Reading {
    Reading { inside: rects.iter().any(|r| contains(r, x, y)), far: !rects.iter().any(|r| near(r, x, y)) }
}

/// Reports only changes of "inside".
#[derive(Default)]
pub struct Tracker {
    inside: bool,
}

impl Tracker {
    pub fn update(&mut self, inside: bool) -> Option<bool> {
        (inside != self.inside).then(|| {
            self.inside = inside;
            inside
        })
    }

    /// Forgets the last answer, so the next reading is reported even if it is the same. Returns `Some(false)` when
    /// the cursor was inside, which the owner must report as having left.
    pub fn reset(&mut self) -> Option<bool> {
        std::mem::take(&mut self.inside).then_some(false)
    }
}

/// What the poller needs from the window it watches.
pub trait Watched: Send + 'static {
    /// Cursor position in the window's CSS px, or `None` when it cannot be read (the window is gone).
    fn cursor(&self) -> Option<(f64, f64)>;
    /// The window should take clicks (`true`) or let them through (`false`).
    fn take_clicks(&self, on: bool);
}

/// Whether the poller should look at all. The dock is paused while nothing of it is on screen (frozen, hidden, not
/// started yet): the poller then sleeps on a condition variable and costs nothing.
#[derive(Default)]
pub struct Pause {
    paused: Mutex<bool>,
    changed: Condvar,
}

impl Pause {
    pub fn set(&self, paused: bool) {
        *self.paused.lock().unwrap_or_else(PoisonError::into_inner) = paused;
        self.changed.notify_all();
    }

    pub fn is_paused(&self) -> bool {
        *self.paused.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Blocks until the pause ends or `stop` is set (the poller's owner wakes it with `nudge`).
    fn wait_resumed(&self, stop: &AtomicBool) {
        let mut paused = self.paused.lock().unwrap_or_else(PoisonError::into_inner);
        while *paused && !stop.load(Ordering::Acquire) {
            paused = self.changed.wait(paused).unwrap_or_else(PoisonError::into_inner);
        }
    }

    fn nudge(&self) {
        // Taking the lock first means the poller is either still to check `stop` or already waiting.
        let _held = self.paused.lock().unwrap_or_else(PoisonError::into_inner);
        self.changed.notify_all();
    }
}

/// Stops its thread when dropped.
pub struct Poller {
    stop: Arc<AtomicBool>,
    pause: Arc<Pause>,
    thread: Option<JoinHandle<()>>,
}

impl Poller {
    /// Polls on a thread of its own while `pause` is not set; `changed` is called with each change of "inside".
    pub fn start(
        watched: impl Watched,
        regions: Arc<Regions>,
        pause: Arc<Pause>,
        changed: impl Fn(bool) + Send + 'static,
    ) -> std::io::Result<Poller> {
        let stop = Arc::new(AtomicBool::new(false));
        let (flag, paused) = (Arc::clone(&stop), Arc::clone(&pause));
        let thread = thread::Builder::new().name("dock-pointer".into()).spawn(move || {
            let mut tracker = Tracker::default();
            while !flag.load(Ordering::Acquire) {
                if paused.is_paused() {
                    // Nothing is drawn, so nothing is under the cursor: the dock must not think it is.
                    if tracker.reset().is_some() {
                        watched.take_clicks(false);
                        changed(false);
                    }
                    paused.wait_resumed(&flag);
                    continue;
                }
                let mut wait = FAR_TICK;
                if let Some((x, y)) = watched.cursor() {
                    let reading = read(&regions.snapshot(), x, y);
                    if let Some(inside) = tracker.update(reading.inside) {
                        watched.take_clicks(inside);
                        changed(inside);
                    }
                    if !reading.far {
                        wait = NEAR_TICK;
                    }
                }
                thread::park_timeout(wait);
            }
        })?;
        Ok(Poller { stop, pause, thread: Some(thread) })
    }

    /// Looks again now, for example right after the regions changed.
    pub fn wake(&self) {
        if let Some(thread) = &self.thread {
            thread.thread().unpark();
        }
    }
}

impl Drop for Poller {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.pause.nudge();
        if let Some(thread) = self.thread.take() {
            thread.thread().unpark();
            let _ = thread.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BAR: Rect = Rect { x: 600.0, y: 980.0, w: 700.0, h: 80.0 };

    #[test]
    fn inside_means_inside_a_region() {
        assert!(read(&[BAR], 900.0, 1000.0).inside);
        assert!(read(&[BAR], 600.0, 980.0).inside, "the top-left edge belongs to the region");
        assert!(!read(&[BAR], 1300.0, 1000.0).inside, "the far edge does not");
        assert!(!read(&[BAR], 900.0, 500.0).inside);
        assert!(!read(&[], 900.0, 1000.0).inside);
    }

    #[test]
    fn any_region_counts() {
        let popover = Rect { x: 700.0, y: 600.0, w: 300.0, h: 300.0 };
        assert!(read(&[BAR, popover], 800.0, 700.0).inside);
    }

    #[test]
    fn polling_slows_down_far_from_every_region() {
        assert!(!read(&[BAR], 900.0, 900.0).far, "near the bar");
        assert!(!read(&[BAR], 450.0, 1000.0).far, "within reach of the left end");
        assert!(read(&[BAR], 100.0, 100.0).far);
        assert!(read(&[], 900.0, 1000.0).far, "no regions: nothing to be near");
    }

    #[test]
    fn a_fast_flick_cannot_skip_the_near_zone() {
        // The cursor covers at most this many px in one far tick at 3000 px/s.
        let flick = 3000.0 * FAR_TICK.as_secs_f64();
        assert!(flick < NEAR_DISTANCE, "{flick}");
    }

    #[test]
    fn only_changes_are_reported() {
        let mut tracker = Tracker::default();
        assert_eq!(tracker.update(false), None);
        assert_eq!(tracker.update(true), Some(true));
        assert_eq!(tracker.update(true), None);
        assert_eq!(tracker.update(false), Some(false));
        assert_eq!(tracker.update(false), None);
    }

    #[test]
    fn a_reset_reports_the_next_inside_again() {
        let mut tracker = Tracker::default();
        tracker.update(true);
        assert_eq!(tracker.reset(), Some(false), "the cursor was inside, so it has to be told it left");
        assert_eq!(tracker.update(true), Some(true));
        assert_eq!(Tracker::default().reset(), None);
    }

    struct Probe {
        cursor: Mutex<(f64, f64)>,
        clicks: Arc<Mutex<Vec<bool>>>,
    }

    impl Watched for Arc<Probe> {
        fn cursor(&self) -> Option<(f64, f64)> {
            Some(*self.cursor.lock().unwrap())
        }

        fn take_clicks(&self, on: bool) {
            self.clicks.lock().unwrap().push(on);
        }
    }

    fn wait_for(condition: impl Fn() -> bool) -> bool {
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            if condition() {
                return true;
            }
            thread::sleep(Duration::from_millis(5));
        }
        false
    }

    #[test]
    fn the_poller_turns_the_cursor_into_clicks_and_events() {
        let clicks = Arc::new(Mutex::new(Vec::new()));
        let probe = Arc::new(Probe { cursor: Mutex::new((10.0, 10.0)), clicks: Arc::clone(&clicks) });
        let regions = Arc::new(Regions::default());
        regions.replace(vec![BAR]);
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let poller = Poller::start(
            Arc::clone(&probe),
            Arc::clone(&regions),
            Arc::new(Pause::default()),
            move |inside| sink.lock().unwrap().push(inside),
        )
        .expect("poller");

        *probe.cursor.lock().unwrap() = (900.0, 1000.0);
        assert!(wait_for(|| events.lock().unwrap().as_slice() == [true]));
        *probe.cursor.lock().unwrap() = (10.0, 10.0);
        assert!(wait_for(|| events.lock().unwrap().as_slice() == [true, false]));
        assert_eq!(*clicks.lock().unwrap(), vec![true, false]);
        drop(poller);
    }

    #[test]
    fn a_paused_dock_is_not_polled_and_resumes_at_once() {
        let clicks = Arc::new(Mutex::new(Vec::new()));
        let probe = Arc::new(Probe { cursor: Mutex::new((900.0, 1000.0)), clicks: Arc::clone(&clicks) });
        let regions = Arc::new(Regions::default());
        regions.replace(vec![BAR]);
        let pause = Arc::new(Pause::default());
        pause.set(true);
        let poller = Poller::start(Arc::clone(&probe), regions, Arc::clone(&pause), |_| {}).expect("poller");
        thread::sleep(FAR_TICK * 3);
        assert!(clicks.lock().unwrap().is_empty(), "nothing is read while paused");
        pause.set(false);
        assert!(wait_for(|| clicks.lock().unwrap().as_slice() == [true]));
        pause.set(true);
        assert!(wait_for(|| clicks.lock().unwrap().as_slice() == [true, false]), "pausing lets the clicks through");
        drop(poller);
    }

    #[test]
    fn dropping_a_paused_poller_does_not_hang() {
        let probe = Arc::new(Probe { cursor: Mutex::new((0.0, 0.0)), clicks: Arc::default() });
        let pause = Arc::new(Pause::default());
        pause.set(true);
        let poller = Poller::start(probe, Arc::default(), pause, |_| {}).expect("poller");
        drop(poller);
    }
}

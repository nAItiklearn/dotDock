//! Cursor awareness for a window that is click-through most of the time.
//!
//! A click-through window gets no mouse events, so the app polls the cursor position (a single cheap syscall
//! per tick, the approach of D-006) and reports three things:
//! - when the cursor enters or leaves the island's *footprint* (so the island can move out of the way),
//! - when it is over a part that should accept clicks (so the window can stop being click-through),
//! - when it touches the top edge of another monitor (so the island can follow).

use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Tick while the cursor is near the island, and while it is far away.
const NEAR_TICK: Duration = Duration::from_millis(16);
const FAR_TICK: Duration = Duration::from_millis(80);
/// Cursor within this many pixels of the footprint counts as near.
const NEAR_DISTANCE: i32 = 96;
/// The cursor must stay at the very top of a monitor this long before the island follows, to ignore flicks.
const EDGE_DWELL_TICKS: u32 = 8;
/// A cursor this close to a monitor's top edge keeps polling fast, so the dwell is measured at one pace.
const EDGE_NEAR_PX: i32 = 12;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub fn contains(&self, p: (i32, i32)) -> bool {
        p.0 >= self.x && p.0 < self.x + self.w && p.1 >= self.y && p.1 < self.y + self.h
    }

    fn near(&self, p: (i32, i32), distance: i32) -> bool {
        Rect { x: self.x - distance, y: self.y - distance, w: self.w + 2 * distance, h: self.h + 2 * distance }
            .contains(p)
    }
}

/// Rectangle in CSS pixels as the island window reports it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Deserialize)]
pub struct CssRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// What the island window reports through `island_set_regions`, in CSS pixels relative to the window.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct Regions {
    pub interactive: Vec<CssRect>,
    pub hover: Option<CssRect>,
}

/// The same regions in physical screen pixels.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ScreenRegions {
    pub interactive: Vec<Rect>,
    pub hover: Option<Rect>,
}

impl Regions {
    /// `origin` is the window's top-left on screen in physical pixels; `scale` its DPI factor.
    pub fn to_screen(&self, origin: (i32, i32), scale: f64) -> ScreenRegions {
        let convert = |r: &CssRect| Rect {
            x: origin.0 + (r.x * scale).floor() as i32,
            y: origin.1 + (r.y * scale).floor() as i32,
            w: (r.w * scale).ceil() as i32,
            h: (r.h * scale).ceil() as i32,
        };
        ScreenRegions {
            interactive: self.interactive.iter().map(convert).collect(),
            hover: self.hover.as_ref().map(convert),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PointerEvent {
    /// The cursor entered (true) or left (false) the island's footprint.
    Hover(bool),
    /// The window should accept clicks (true) or let them through (false).
    Interactive(bool),
    /// The cursor dwelt on the top edge of this monitor, which is not the island's monitor.
    TopEdge(Rect),
}

/// What the poller needs to know each tick. `None` pauses it (the window does not exist yet).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Target {
    pub regions: ScreenRegions,
    /// Monitor the island is on, for edge following. `None` disables following.
    pub island_monitor: Option<Rect>,
}

/// Tracks the previous answers so only changes are reported.
#[derive(Default)]
pub struct Tracker {
    hover: bool,
    interactive: bool,
    edge_ticks: u32,
    edge_reported: bool,
}

impl Tracker {
    pub fn update(&mut self, cursor: (i32, i32), target: &Target, cursor_monitor: Option<Rect>) -> Vec<PointerEvent> {
        let mut events = Vec::new();
        let hover = target.regions.hover.is_some_and(|r| r.contains(cursor));
        if hover != self.hover {
            self.hover = hover;
            events.push(PointerEvent::Hover(hover));
        }
        let interactive = target.regions.interactive.iter().any(|r| r.contains(cursor));
        if interactive != self.interactive {
            self.interactive = interactive;
            events.push(PointerEvent::Interactive(interactive));
        }
        match (target.island_monitor, cursor_monitor) {
            (Some(island), Some(here)) if island != here && cursor.1 <= here.y + 1 => {
                self.edge_ticks += 1;
                if self.edge_ticks >= EDGE_DWELL_TICKS && !self.edge_reported {
                    self.edge_reported = true;
                    events.push(PointerEvent::TopEdge(here));
                }
            }
            _ => {
                self.edge_ticks = 0;
                self.edge_reported = false;
            }
        }
        events
    }

    /// True when the cursor is far from everything that matters, so polling can slow down.
    pub fn is_far(cursor: (i32, i32), target: &Target, cursor_monitor: Option<Rect>) -> bool {
        let near_region =
            target.regions.hover.iter().chain(target.regions.interactive.iter()).any(|r| r.near(cursor, NEAR_DISTANCE));
        let near_edge = cursor_monitor.is_some_and(|m| cursor.1 <= m.y + EDGE_NEAR_PX);
        !near_region && !near_edge
    }
}

#[cfg(windows)]
mod imp {
    use super::Rect;
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    pub fn cursor() -> Option<(i32, i32)> {
        let mut p = POINT::default();
        // SAFETY: `p` is a live POINT on this stack frame.
        unsafe { GetCursorPos(&mut p).ok()? };
        Some((p.x, p.y))
    }

    pub fn monitor_at(point: (i32, i32)) -> Option<Rect> {
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        // SAFETY: `info` is initialised with its size as the API requires and outlives the call.
        unsafe {
            let monitor = MonitorFromPoint(POINT { x: point.0, y: point.1 }, MONITOR_DEFAULTTONEAREST);
            if !GetMonitorInfoW(monitor, &mut info).as_bool() {
                return None;
            }
        }
        let r = info.rcMonitor;
        Some(Rect { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top })
    }
}

#[cfg(not(windows))]
mod imp {
    use super::Rect;
    pub fn cursor() -> Option<(i32, i32)> {
        None
    }
    pub fn monitor_at(_point: (i32, i32)) -> Option<Rect> {
        None
    }
}

/// The monitor that contains `point` (physical screen pixels).
pub fn monitor_at(point: (i32, i32)) -> Option<Rect> {
    imp::monitor_at(point)
}

/// Stops its thread when dropped.
pub struct Poller {
    stop: Arc<AtomicBool>,
}

impl Drop for Poller {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Polls the cursor on its own thread. `target` is called every tick and must be cheap (read a mutex, ask the
/// window for its position); `sink` receives only changes.
pub fn spawn_poller(
    target: impl Fn() -> Option<Target> + Send + 'static,
    mut sink: impl FnMut(PointerEvent) + Send + 'static,
) -> std::io::Result<Poller> {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    std::thread::Builder::new().name("island-pointer".into()).spawn(move || {
        let mut tracker = Tracker::default();
        while !flag.load(Ordering::Relaxed) {
            let mut pause = FAR_TICK;
            if let (Some(target), Some(cursor)) = (target(), imp::cursor()) {
                let monitor = target.island_monitor.and_then(|_| imp::monitor_at(cursor));
                tracker.update(cursor, &target, monitor).into_iter().for_each(&mut sink);
                if !Tracker::is_far(cursor, &target, monitor) {
                    pause = NEAR_TICK;
                }
            }
            std::thread::sleep(pause);
        }
    })?;
    Ok(Poller { stop })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(hover: Option<Rect>, interactive: Vec<Rect>, monitor: Option<Rect>) -> Target {
        Target { regions: ScreenRegions { interactive, hover }, island_monitor: monitor }
    }

    const BODY: Rect = Rect { x: 800, y: 10, w: 320, h: 100 };
    const MAIN: Rect = Rect { x: 0, y: 0, w: 1920, h: 1080 };
    const SECOND: Rect = Rect { x: 1920, y: 0, w: 1920, h: 1080 };

    #[test]
    fn reports_hover_and_interactive_only_on_change() {
        let mut t = Tracker::default();
        let target = target(Some(BODY), vec![BODY], None);
        assert!(t.update((10, 10), &target, None).is_empty());
        assert_eq!(
            t.update((900, 50), &target, None),
            vec![PointerEvent::Hover(true), PointerEvent::Interactive(true)]
        );
        assert!(t.update((901, 51), &target, None).is_empty());
        assert_eq!(
            t.update((10, 10), &target, None),
            vec![PointerEvent::Hover(false), PointerEvent::Interactive(false)]
        );
    }

    #[test]
    fn hover_can_stay_true_while_the_window_is_click_through() {
        let mut t = Tracker::default();
        let aside = target(Some(BODY), vec![], None);
        assert_eq!(t.update((900, 50), &aside, None), vec![PointerEvent::Hover(true)]);
        assert!(t.update((905, 60), &aside, None).is_empty(), "no interactive region, so clicks pass through");
    }

    #[test]
    fn regions_convert_from_css_to_screen_pixels() {
        let regions = Regions {
            interactive: vec![CssRect { x: 100.0, y: 10.0, w: 320.0, h: 90.5 }],
            hover: Some(CssRect { x: 90.0, y: 0.0, w: 340.0, h: 120.0 }),
        };
        let screen = regions.to_screen((1000, 0), 1.25);
        assert_eq!(screen.interactive[0], Rect { x: 1125, y: 12, w: 400, h: 114 });
        assert_eq!(screen.hover, Some(Rect { x: 1112, y: 0, w: 425, h: 150 }));
    }

    #[test]
    fn dwelling_on_another_monitors_top_edge_reports_once() {
        let mut t = Tracker::default();
        let target = target(None, vec![], Some(MAIN));
        for _ in 0..EDGE_DWELL_TICKS - 1 {
            assert!(t.update((2500, 0), &target, Some(SECOND)).is_empty());
        }
        assert_eq!(t.update((2500, 0), &target, Some(SECOND)), vec![PointerEvent::TopEdge(SECOND)]);
        assert!(t.update((2500, 0), &target, Some(SECOND)).is_empty(), "reported once per visit");
        t.update((2500, 400), &target, Some(SECOND));
        assert_eq!(t.edge_ticks, 0, "leaving the edge resets the dwell");
    }

    #[test]
    fn the_islands_own_monitor_and_flicks_never_trigger_following() {
        let mut t = Tracker::default();
        let target = target(None, vec![], Some(MAIN));
        for _ in 0..20 {
            assert!(t.update((500, 0), &target, Some(MAIN)).is_empty());
        }
        assert!(t.update((2500, 0), &target, Some(SECOND)).is_empty(), "one tick is a flick");
        assert!(t.update((2500, 300), &target, Some(SECOND)).is_empty());
    }

    #[test]
    fn polling_slows_down_far_from_the_island() {
        let near = target(Some(BODY), vec![], None);
        assert!(!Tracker::is_far((850, 200), &near, None));
        assert!(Tracker::is_far((100, 900), &near, None));
        let following = target(None, vec![], Some(MAIN));
        assert!(Tracker::is_far((100, 900), &following, Some(MAIN)));
        assert!(!Tracker::is_far((100, 3), &following, Some(MAIN)), "near a top edge the dwell needs the fast pace");
    }
}

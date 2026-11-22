//! When the dock should stop rendering: the session is locked, the display is off, or a full-screen app has
//! the foreground. The sensors (`running::sensors`) feed these functions; the host asks `FrozenState::frozen`
//! and tells the dock window to stop drawing. The state is plain data so the rules are tested everywhere.

use serde::ser::{SerializeStruct, Serializer};
use serde::Serialize;

/// `WTS_*` session change codes (wtsapi32.h) the dock acts on.
pub mod session {
    pub const CONSOLE_CONNECT: u32 = 0x1;
    pub const CONSOLE_DISCONNECT: u32 = 0x2;
    pub const REMOTE_CONNECT: u32 = 0x3;
    pub const REMOTE_DISCONNECT: u32 = 0x4;
    pub const LOCK: u32 = 0x7;
    pub const UNLOCK: u32 = 0x8;
}

/// `QUERY_USER_NOTIFICATION_STATE` values (shellapi.h).
pub mod notification {
    /// Screen saver running, session locked or fast user switching.
    pub const NOT_PRESENT: i32 = 1;
    /// A full-screen app that is not Direct3D.
    pub const BUSY: i32 = 2;
    pub const RUNNING_D3D_FULL_SCREEN: i32 = 3;
    pub const PRESENTATION_MODE: i32 = 4;
}

/// `GUID_CONSOLE_DISPLAY_STATE` payload values.
pub mod display {
    pub const OFF: u32 = 0;
}

/// Event name the host emits `FrozenState` under (`"dock://frozen"` in `protocol.ts`).
pub const EVENT_FROZEN: &str = "dock://frozen";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FrozenState {
    /// The session is locked or disconnected.
    pub locked: bool,
    pub display_off: bool,
    /// A full-screen app, a presentation, or the screen saver has the screen.
    pub fullscreen: bool,
}

/// On the wire the three reasons come with their verdict (`frozen`), so a window that only wants to know whether to
/// draw does not have to combine them.
impl Serialize for FrozenState {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("FrozenState", 4)?;
        state.serialize_field("locked", &self.locked)?;
        state.serialize_field("displayOff", &self.display_off)?;
        state.serialize_field("fullscreen", &self.fullscreen)?;
        state.serialize_field("frozen", &self.frozen())?;
        state.end()
    }
}

impl FrozenState {
    /// True when nothing the dock draws can be seen, so it should not render.
    pub fn frozen(&self) -> bool {
        self.locked || self.display_off || self.fullscreen
    }

    /// Applies a `WM_WTSSESSION_CHANGE` code; unrelated codes change nothing.
    pub fn with_session_change(mut self, code: u32) -> Self {
        match code {
            session::LOCK | session::CONSOLE_DISCONNECT | session::REMOTE_DISCONNECT => self.locked = true,
            session::UNLOCK | session::CONSOLE_CONNECT | session::REMOTE_CONNECT => self.locked = false,
            _ => {}
        }
        self
    }

    /// Applies a `GUID_CONSOLE_DISPLAY_STATE` value: 0 off, 1 on, 2 dimmed (still visible).
    pub fn with_display_state(mut self, value: u32) -> Self {
        self.display_off = value == display::OFF;
        self
    }

    /// Applies the answer of `SHQueryUserNotificationState` and whether another app's window fills its monitor
    /// (`fills_monitor`). The shell's own "busy" answer is not used: it counts dotDock's monitor-sized dock and
    /// desktop windows as a full-screen app, so the dock hid itself on every change of foreground (D-035).
    pub fn with_full_screen(mut self, state: i32, foreground_fills_monitor: bool) -> Self {
        self.fullscreen = foreground_fills_monitor
            || matches!(
                state,
                notification::NOT_PRESENT | notification::RUNNING_D3D_FULL_SCREEN | notification::PRESENTATION_MODE
            );
        self
    }
}

/// A rectangle in physical px, edges as Win32 gives them (`right` and `bottom` exclusive).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Edges {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// Whether a foreground window is a full-screen app: it covers the whole of its monitor, is not merely maximised
/// and has no title bar. Games, players and browsers in full screen drop their title bar; an ordinary window that
/// was dragged or restored to the size of the screen keeps it (File Explorer did, and the dock vanished under it).
pub fn fills_monitor(window: Edges, monitor: Edges, maximised: bool, titled: bool) -> bool {
    !maximised
        && !titled
        && window.left <= monitor.left
        && window.top <= monitor.top
        && window.right >= monitor.right
        && window.bottom >= monitor.bottom
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_frozen_at_rest() {
        assert!(!FrozenState::default().frozen());
    }

    #[test]
    fn locking_and_unlocking() {
        let s = FrozenState::default().with_session_change(session::LOCK);
        assert!(s.locked && s.frozen());
        let s = s.with_session_change(session::UNLOCK);
        assert!(!s.locked && !s.frozen());
    }

    #[test]
    fn disconnecting_the_console_counts_as_locked() {
        assert!(FrozenState::default().with_session_change(session::CONSOLE_DISCONNECT).locked);
        assert!(
            !FrozenState::default()
                .with_session_change(session::CONSOLE_DISCONNECT)
                .with_session_change(session::CONSOLE_CONNECT)
                .locked
        );
    }

    #[test]
    fn unrelated_session_codes_are_ignored() {
        let s = FrozenState { locked: true, ..FrozenState::default() };
        assert_eq!(s.with_session_change(0x5), s);
        assert_eq!(FrozenState::default().with_session_change(0x6), FrozenState::default());
    }

    #[test]
    fn display_off_freezes_but_dimmed_does_not() {
        assert!(FrozenState::default().with_display_state(0).frozen());
        assert!(!FrozenState::default().with_display_state(1).frozen());
        assert!(!FrozenState::default().with_display_state(2).frozen());
        assert!(!FrozenState::default().with_display_state(0).with_display_state(1).frozen());
    }

    #[test]
    fn full_screen_states() {
        // 2 is the shell's "busy", which it also reports for dotDock's own monitor-sized windows: never alone.
        for (state, expected) in
            [(1, true), (2, false), (3, true), (4, true), (5, false), (6, false), (7, false), (0, false)]
        {
            assert_eq!(FrozenState::default().with_full_screen(state, false).fullscreen, expected, "state {state}");
        }
        assert!(FrozenState::default().with_full_screen(5, true).fullscreen, "another app fills its monitor");
    }

    #[test]
    fn the_reasons_combine() {
        let s = FrozenState::default().with_display_state(0).with_full_screen(5, true);
        assert!(s.frozen());
        let s = s.with_display_state(1);
        assert!(s.frozen(), "still full screen");
        assert!(!s.with_full_screen(5, false).frozen());
    }

    const MONITOR: Edges = Edges { left: 0, top: 0, right: 1920, bottom: 1080 };

    #[test]
    fn a_window_covering_its_monitor_is_full_screen() {
        assert!(fills_monitor(MONITOR, MONITOR, false, false));
        // Some games and players overhang the monitor by their invisible borders.
        assert!(fills_monitor(Edges { left: -8, top: -8, right: 1928, bottom: 1088 }, MONITOR, false, false));
    }

    #[test]
    fn a_maximised_or_smaller_window_is_not() {
        assert!(!fills_monitor(Edges { left: -8, top: -8, right: 1928, bottom: 1088 }, MONITOR, true, false));
        assert!(!fills_monitor(Edges { left: 0, top: 0, right: 1920, bottom: 1032 }, MONITOR, false, false));
        assert!(!fills_monitor(Edges { left: 60, top: 80, right: 700, bottom: 500 }, MONITOR, false, false));
    }

    #[test]
    fn a_window_with_a_title_bar_that_fills_the_screen_is_not() {
        assert!(!fills_monitor(Edges { left: -8, top: -8, right: 1928, bottom: 1088 }, MONITOR, false, true));
        assert!(!fills_monitor(MONITOR, MONITOR, false, true));
    }

    #[test]
    fn a_window_on_another_monitor_is_judged_against_that_monitor() {
        let second = Edges { left: 1920, top: 0, right: 3840, bottom: 1080 };
        assert!(fills_monitor(second, second, false, false));
        assert!(!fills_monitor(MONITOR, second, false, false));
    }

    #[test]
    fn serialises_camel_case() {
        let v = serde_json::to_value(FrozenState { locked: false, display_off: true, fullscreen: false }).unwrap();
        assert_eq!(v["displayOff"], true);
        assert_eq!(v["locked"], false);
    }

    #[test]
    fn the_wire_form_carries_the_verdict() {
        let at_rest = serde_json::to_value(FrozenState::default()).unwrap();
        assert_eq!(at_rest["frozen"], false);
        for state in [
            FrozenState { locked: true, ..FrozenState::default() },
            FrozenState { display_off: true, ..FrozenState::default() },
            FrozenState { fullscreen: true, ..FrozenState::default() },
        ] {
            assert_eq!(serde_json::to_value(state).unwrap()["frozen"], true);
        }
    }
}

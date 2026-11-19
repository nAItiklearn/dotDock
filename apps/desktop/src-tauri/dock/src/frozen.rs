//! When the dock should stop rendering: the session is locked, the display is off, or a full-screen app has
//! the foreground. The sensors (`running::sensors`) feed these functions; the host asks `FrozenState::frozen`
//! and tells the dock window to stop drawing. The state is plain data so the rules are tested everywhere.

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

/// Event name the host emits `FrozenState` under. Not part of `protocol.ts` yet; the integration step adds it.
pub const EVENT_FROZEN: &str = "dock://frozen";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenState {
    /// The session is locked or disconnected.
    pub locked: bool,
    pub display_off: bool,
    /// A full-screen app, a presentation, or the screen saver has the screen.
    pub fullscreen: bool,
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

    /// Applies the answer of `SHQueryUserNotificationState`.
    pub fn with_notification_state(mut self, state: i32) -> Self {
        self.fullscreen = matches!(
            state,
            notification::NOT_PRESENT
                | notification::BUSY
                | notification::RUNNING_D3D_FULL_SCREEN
                | notification::PRESENTATION_MODE
        );
        self
    }
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
        for (state, expected) in
            [(1, true), (2, true), (3, true), (4, true), (5, false), (6, false), (7, false), (0, false)]
        {
            assert_eq!(FrozenState::default().with_notification_state(state).fullscreen, expected, "state {state}");
        }
    }

    #[test]
    fn the_reasons_combine() {
        let s = FrozenState::default().with_display_state(0).with_notification_state(2);
        assert!(s.frozen());
        let s = s.with_display_state(1);
        assert!(s.frozen(), "still full screen");
        assert!(!s.with_notification_state(5).frozen());
    }

    #[test]
    fn serialises_camel_case() {
        let v = serde_json::to_value(FrozenState { locked: false, display_off: true, fullscreen: false }).unwrap();
        assert_eq!(v["displayOff"], true);
        assert_eq!(v["locked"], false);
    }
}

//! What the host should be doing for a given set of settings: show the window, keep a strip of the screen free,
//! hide the Windows taskbar. Pure, so every combination is tested without a screen.

use crate::frozen::FrozenState;
use crate::protocol::DockSettings;

/// Everything the host needs to make true.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Plan {
    /// The dock window is on screen.
    pub visible: bool,
    /// Keep the strip along the bottom free of maximised windows.
    pub reserve: bool,
    /// The Windows taskbar is hidden.
    pub hide_taskbar: bool,
}

/// What has happened so far that the plan depends on.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Inputs {
    /// The dock window exists.
    pub window: bool,
    /// The dock UI has asked for its first snapshot, so it can draw.
    pub ui_ready: bool,
    pub frozen: FrozenState,
}

/// The plan for `settings`.
///
/// Nothing changes on screen until the UI is ready to draw: the dock appears first, and only then does the strip
/// get reserved and the taskbar hidden, so the user never sees a desktop with no bar at all. A frozen dock (locked
/// session, display off, a full-screen app in front) is hidden but keeps its reservation and the taskbar state, so
/// nothing jumps when it comes back. An auto-hiding dock reserves nothing: it slides away and gives the space back.
pub fn plan(settings: &DockSettings, inputs: Inputs) -> Plan {
    let live = settings.enabled && inputs.window && inputs.ui_ready;
    Plan {
        visible: live && !inputs.frozen.frozen(),
        reserve: live && settings.reserve_space && !settings.auto_hide,
        hide_taskbar: live && settings.replace_taskbar,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const READY: Inputs = Inputs {
        window: true,
        ui_ready: true,
        frozen: FrozenState { locked: false, display_off: false, fullscreen: false },
    };

    fn plan_reserves(settings: &DockSettings) -> bool {
        plan(settings, READY).reserve
    }

    fn settings(change: impl FnOnce(&mut DockSettings)) -> DockSettings {
        let mut settings = DockSettings::default();
        change(&mut settings);
        settings
    }

    #[test]
    fn a_fresh_install_shows_an_auto_hiding_dock_that_reserves_nothing_and_leaves_the_taskbar_alone() {
        let plan = plan(&DockSettings::default(), READY);
        assert_eq!(plan, Plan { visible: true, reserve: false, hide_taskbar: false });
        let kept_up = settings(|s| s.auto_hide = false);
        assert!(plan_reserves(&kept_up), "a dock that stays up keeps windows clear of it");
    }

    #[test]
    fn nothing_happens_before_the_ui_can_draw() {
        let early = Inputs { ui_ready: false, ..READY };
        let loud = settings(|s| s.replace_taskbar = true);
        assert_eq!(plan(&loud, early), Plan { visible: false, reserve: false, hide_taskbar: false });
        let no_window = Inputs { window: false, ..READY };
        assert_eq!(plan(&loud, no_window), Plan { visible: false, reserve: false, hide_taskbar: false });
    }

    #[test]
    fn a_disabled_dock_does_nothing_at_all() {
        let off = settings(|s| {
            s.enabled = false;
            s.replace_taskbar = true;
        });
        assert_eq!(plan(&off, READY), Plan { visible: false, reserve: false, hide_taskbar: false });
    }

    #[test]
    fn replacing_the_taskbar_hides_it_once_the_dock_is_up() {
        let replace = settings(|s| s.replace_taskbar = true);
        assert!(plan(&replace, READY).hide_taskbar);
    }

    #[test]
    fn floating_and_auto_hiding_docks_reserve_nothing() {
        assert!(!plan(&settings(|s| s.reserve_space = false), READY).reserve);
        assert!(!plan(&settings(|s| s.auto_hide = true), READY).reserve);
    }

    #[test]
    fn a_frozen_dock_hides_but_keeps_the_strip_and_the_taskbar_state() {
        let replace = settings(|s| {
            s.replace_taskbar = true;
            s.auto_hide = false;
        });
        for frozen in [
            FrozenState { locked: true, ..FrozenState::default() },
            FrozenState { display_off: true, ..FrozenState::default() },
            FrozenState { fullscreen: true, ..FrozenState::default() },
        ] {
            let plan = plan(&replace, Inputs { frozen, ..READY });
            assert_eq!(plan, Plan { visible: false, reserve: true, hide_taskbar: true });
        }
    }
}

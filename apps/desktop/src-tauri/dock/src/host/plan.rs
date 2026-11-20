//! What the host should be doing for a given set of settings: show the window, keep a strip of the screen free,
//! hide the Windows taskbar. Pure, so every combination is tested without a screen.

use crate::frozen::FrozenState;
use crate::protocol::{DockEdge, DockSettings};

/// Everything the host needs to make true.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Plan {
    /// The dock window is on screen.
    pub visible: bool,
    /// Keep a strip along this edge free of maximised windows.
    pub reserve: Option<DockEdge>,
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
        reserve: (live && settings.reserve_space && !settings.auto_hide).then_some(settings.edge),
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

    fn settings(change: impl FnOnce(&mut DockSettings)) -> DockSettings {
        let mut settings = DockSettings::default();
        change(&mut settings);
        settings
    }

    #[test]
    fn a_fresh_install_shows_the_dock_and_reserves_space_but_leaves_the_taskbar_alone() {
        let plan = plan(&DockSettings::default(), READY);
        assert_eq!(plan, Plan { visible: true, reserve: Some(DockEdge::Bottom), hide_taskbar: false });
    }

    #[test]
    fn nothing_happens_before_the_ui_can_draw() {
        let early = Inputs { ui_ready: false, ..READY };
        let loud = settings(|s| s.replace_taskbar = true);
        assert_eq!(plan(&loud, early), Plan { visible: false, reserve: None, hide_taskbar: false });
        let no_window = Inputs { window: false, ..READY };
        assert_eq!(plan(&loud, no_window), Plan { visible: false, reserve: None, hide_taskbar: false });
    }

    #[test]
    fn a_disabled_dock_does_nothing_at_all() {
        let off = settings(|s| {
            s.enabled = false;
            s.replace_taskbar = true;
        });
        assert_eq!(plan(&off, READY), Plan { visible: false, reserve: None, hide_taskbar: false });
    }

    #[test]
    fn replacing_the_taskbar_hides_it_once_the_dock_is_up() {
        let replace = settings(|s| s.replace_taskbar = true);
        assert!(plan(&replace, READY).hide_taskbar);
    }

    #[test]
    fn the_reserved_strip_follows_the_edge() {
        for edge in [DockEdge::Top, DockEdge::Left, DockEdge::Right, DockEdge::Bottom] {
            assert_eq!(plan(&settings(|s| s.edge = edge), READY).reserve, Some(edge));
        }
    }

    #[test]
    fn floating_and_auto_hiding_docks_reserve_nothing() {
        assert_eq!(plan(&settings(|s| s.reserve_space = false), READY).reserve, None);
        assert_eq!(plan(&settings(|s| s.auto_hide = true), READY).reserve, None);
    }

    #[test]
    fn a_frozen_dock_hides_but_keeps_the_strip_and_the_taskbar_state() {
        let replace = settings(|s| s.replace_taskbar = true);
        for frozen in [
            FrozenState { locked: true, ..FrozenState::default() },
            FrozenState { display_off: true, ..FrozenState::default() },
            FrozenState { fullscreen: true, ..FrozenState::default() },
        ] {
            let plan = plan(&replace, Inputs { frozen, ..READY });
            assert_eq!(plan, Plan { visible: false, reserve: Some(DockEdge::Bottom), hide_taskbar: true });
        }
    }
}

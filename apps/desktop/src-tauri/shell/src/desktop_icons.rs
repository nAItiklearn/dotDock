//! Shows or hides the stock desktop icons the same way Explorer's own "Show desktop icons" menu item
//! does: the desktop folder view toggles itself on its own command, and `HideIcons` keeps the choice
//! across sign-ins. The snapshot records the original, and restore puts it back.

use crate::registry;
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowExW, FindWindowW, IsWindowVisible, SendMessageTimeoutW, SMTO_ABORTIFHUNG, WM_COMMAND,
};

const ADVANCED_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";
const HIDE_ICONS_VALUE: &str = "HideIcons";
/// Explorer's "Show desktop icons" menu command on the desktop folder view (SHELLDLL_DefView).
const TOGGLE_DESKTOP_ICONS: usize = 0x7402;
/// A hung Explorer must never hang the caller.
const SEND_TIMEOUT_MS: u32 = 2000;

/// The desktop's folder view. It lives under Progman, or under a WorkerW once a wallpaper slideshow
/// or animated wallpaper has split the desktop.
fn defview() -> Option<HWND> {
    // SAFETY: window lookups by class name; every handle is checked before use.
    unsafe {
        let progman = FindWindowW(w!("Progman"), None).ok()?;
        if let Ok(view) = FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), None) {
            return Some(view);
        }
        let mut worker = FindWindowExW(None, None, w!("WorkerW"), None).ok();
        while let Some(w) = worker {
            if let Ok(view) = FindWindowExW(Some(w), None, w!("SHELLDLL_DefView"), None) {
                return Some(view);
            }
            worker = FindWindowExW(None, Some(w), w!("WorkerW"), None).ok();
        }
        None
    }
}

/// Whether the icons are on screen now; None when the desktop is not hosted by Explorer.
pub fn visible() -> Option<bool> {
    let view = defview()?;
    // SAFETY: lookup of a child of the folder view; IsWindowVisible has no preconditions.
    unsafe {
        let list = FindWindowExW(Some(view), None, w!("SysListView32"), None).ok()?;
        Some(IsWindowVisible(list).as_bool())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum DesktopIconsError {
    #[error("the Windows desktop is not running")]
    NoDesktop,
    #[error("Explorer did not change the desktop icons")]
    Unchanged,
    #[error(transparent)]
    Registry(#[from] registry::RegistryError),
}

/// Makes the icons visible or hidden. Does nothing when they already are.
pub fn set_visible(show: bool) -> Result<(), DesktopIconsError> {
    let current = visible().ok_or(DesktopIconsError::NoDesktop)?;
    if current != show {
        let view = defview().ok_or(DesktopIconsError::NoDesktop)?;
        // SAFETY: posts Explorer's own menu command to its window, with a timeout.
        unsafe {
            SendMessageTimeoutW(
                view,
                WM_COMMAND,
                WPARAM(TOGGLE_DESKTOP_ICONS),
                LPARAM(0),
                SMTO_ABORTIFHUNG,
                SEND_TIMEOUT_MS,
                None,
            );
        }
        if visible() != Some(show) {
            return Err(DesktopIconsError::Unchanged);
        }
    }
    registry::set_dword(ADVANCED_KEY, HIDE_ICONS_VALUE, u32::from(!show))?;
    Ok(())
}

/// What restore should put back: the snapshot's observed visibility, else its `HideIcons` value,
/// else visible (Windows' default).
pub fn original(observed: Option<bool>, hide_icons_registry: Option<u32>) -> bool {
    observed.unwrap_or(hide_icons_registry != Some(1))
}

// ------------------------------------------------------- owned by the environment

/// What the environment should do to Windows' desktop icons (B4, `docs/BUGS_1_0_3.md`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Hide them, and record that dotDock did, so a crashed run can still put them back.
    Hide,
    /// Put them back the way the snapshot found them, and drop the record.
    Restore { visible: bool },
    /// Windows' own setting is not ours to touch.
    Leave,
}

/// Decides from the environment's state and what dotDock did last time. The icons clutter the widget
/// layer, so the environment owns them while it runs: it hides them on every start (hiding what is
/// already hidden does nothing), and gives them back the moment it is switched off. `ours` is the
/// record from disk, which is how a run that crashed while they were hidden is undone on the next start.
pub fn decide(environment_on: bool, ours: bool, original_visible: bool) -> Action {
    match (environment_on, ours) {
        (true, _) => Action::Hide,
        (false, true) => Action::Restore { visible: original_visible },
        (false, false) => Action::Leave,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_prefers_what_was_seen_then_the_registry_then_visible() {
        assert!(!original(Some(false), Some(0)));
        assert!(original(Some(true), Some(1)));
        assert!(!original(None, Some(1)));
        assert!(original(None, Some(0)));
        assert!(original(None, None));
    }

    #[test]
    fn the_environment_hides_the_icons_while_it_runs() {
        assert_eq!(decide(true, false, true), Action::Hide);
    }

    #[test]
    fn a_start_hides_them_again_even_when_dotdock_already_owns_them() {
        // Explorer restarting, or the user pressing "Show desktop icons", must not leave them on top of the widgets.
        assert_eq!(decide(true, true, true), Action::Hide);
    }

    #[test]
    fn switching_the_environment_off_gives_the_icons_back_as_they_were() {
        assert_eq!(decide(false, true, true), Action::Restore { visible: true });
        assert_eq!(decide(false, true, false), Action::Restore { visible: false });
    }

    #[test]
    fn a_run_that_crashed_with_the_icons_hidden_is_undone_at_the_next_start() {
        // The environment is off this time, but the record says the icons are ours: hand them back.
        assert_eq!(decide(false, true, true), Action::Restore { visible: true });
    }

    #[test]
    fn icons_dotdock_never_hid_are_left_exactly_as_the_user_set_them() {
        assert_eq!(decide(false, false, true), Action::Leave);
        assert_eq!(decide(false, false, false), Action::Leave);
    }
}

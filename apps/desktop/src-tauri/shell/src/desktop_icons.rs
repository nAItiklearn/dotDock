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
}

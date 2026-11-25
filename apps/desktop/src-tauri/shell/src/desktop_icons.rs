//! Shows or hides the stock desktop icons the same way Explorer's own "Show desktop icons" menu item
//! does: the desktop folder view toggles itself on its own command, and `HideIcons` keeps the choice
//! across sign-ins. The snapshot records the original, and restore puts it back.

use crate::registry;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::Path;
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

/// Where dotDock records that it, and not the user, hid the icons. A separate small file rather than a
/// field of the snapshot: the snapshot describes the original Windows state and is written once, while
/// this changes every time the theme is switched. `tools/restore-windows.ps1` deletes it too.
pub const OWNED_FILE: &str = "desktop-icons.json";
const OWNED_SCHEMA: u32 = 1;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Owned {
    schema: u32,
    hidden_by_dotdock: bool,
}

/// Whether dotDock is the one keeping the icons hidden. A missing or unreadable record means no: the
/// user's own setting is never undone on a guess.
pub fn owned(dir: &Path) -> bool {
    std::fs::read(dir.join(OWNED_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Owned>(&bytes).ok())
        .is_some_and(|o| o.hidden_by_dotdock)
}

/// Write-then-rename, flushed, so a power cut leaves the old record or the new one, never half of one.
fn remember(dir: &Path, hidden_by_dotdock: bool) -> std::io::Result<()> {
    let path = dir.join(OWNED_FILE);
    let tmp = path.with_extension("json.tmp");
    let mut file = std::fs::File::create(&tmp)?;
    file.write_all(&serde_json::to_vec_pretty(&Owned { schema: OWNED_SCHEMA, hidden_by_dotdock })?)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(tmp, path)
}

/// Drops the record, so dotDock no longer claims the icons. Used after restoring them.
pub fn forget(dir: &Path) {
    // Best effort: a record that cannot be removed only means the next start restores icons that are
    // already visible, which changes nothing.
    let _ = std::fs::remove_file(dir.join(OWNED_FILE));
}

/// What [`apply`] did, in words for the boot log.
#[derive(Debug, PartialEq, Eq)]
pub enum Applied {
    Hidden,
    /// The user's own setting is back; the value is what it was.
    Restored(bool),
    /// Windows' setting was not dotDock's to touch.
    Left,
    Failed(String),
}

/// Brings Windows' desktop icons in line with the environment, and records who owns them.
///
/// `dir` is the app data folder. The original is snapshotted before the first change, so both
/// `restore_windows` and `tools/restore-windows.ps1` can always put it back; a snapshot that cannot be
/// taken stops the change rather than hiding icons nothing could restore.
pub fn apply(dir: &Path, environment_on: bool) -> Applied {
    let snapshot = match crate::snapshot::load() {
        Ok(snap) => snap,
        Err(e) => return Applied::Failed(e.to_string()),
    };
    let was_visible = original(
        snapshot.as_ref().and_then(|s| s.desktop_icons_visible),
        snapshot.as_ref().and_then(|s| s.hide_icons_registry),
    );
    match decide(environment_on, owned(dir), was_visible) {
        Action::Leave => Applied::Left,
        Action::Hide => {
            if let Err(e) = crate::snapshot::ensure(false) {
                return Applied::Failed(e.to_string());
            }
            match set_visible(false) {
                Ok(()) => {
                    if let Err(e) = remember(dir, true) {
                        // The icons are hidden with nothing on record: put them back rather than leave a
                        // change only a hand edit could undo.
                        let _ = set_visible(was_visible);
                        return Applied::Failed(e.to_string());
                    }
                    Applied::Hidden
                }
                Err(e) => Applied::Failed(e.to_string()),
            }
        }
        Action::Restore { visible } => match set_visible(visible) {
            Ok(()) => {
                forget(dir);
                Applied::Restored(visible)
            }
            Err(e) => Applied::Failed(e.to_string()),
        },
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

    #[test]
    fn a_machine_with_no_record_does_not_claim_the_icons() {
        let dir = tempfile::tempdir().expect("dir");
        assert!(!owned(dir.path()));
    }

    #[test]
    fn the_record_survives_being_written_and_read_back() {
        let dir = tempfile::tempdir().expect("dir");
        remember(dir.path(), true).expect("write");
        assert!(owned(dir.path()));
        remember(dir.path(), false).expect("write");
        assert!(!owned(dir.path()));
    }

    #[test]
    fn forgetting_hands_the_icons_back_to_the_user() {
        let dir = tempfile::tempdir().expect("dir");
        remember(dir.path(), true).expect("write");
        forget(dir.path());
        assert!(!owned(dir.path()));
        // Forgetting twice is not an error: restore runs whether or not dotDock had the icons.
        forget(dir.path());
        assert!(!owned(dir.path()));
    }

    #[test]
    fn a_record_that_cannot_be_read_never_undoes_the_users_own_setting() {
        let dir = tempfile::tempdir().expect("dir");
        std::fs::write(dir.path().join(OWNED_FILE), "{ not json").expect("write");
        assert!(!owned(dir.path()));
    }

    #[test]
    fn no_half_written_record_is_left_behind() {
        let dir = tempfile::tempdir().expect("dir");
        remember(dir.path(), true).expect("write");
        let left: Vec<_> = std::fs::read_dir(dir.path())
            .expect("list")
            .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
            .collect();
        assert_eq!(left, vec![OWNED_FILE.to_owned()]);
    }
}

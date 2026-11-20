//! The core's own preferences, kept apart from the UI's settings document: `core.json` in the app
//! data folder. Today that is only whether dotDock or Windows is in charge of the desktop.

use serde::{Deserialize, Serialize};
use std::path::Path;

pub const FILE: &str = "core.json";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CorePrefs {
    /// False hands the desktop back to Windows: the overlay stays closed until switched on again.
    pub use_our_desktop: bool,
}

impl Default for CorePrefs {
    fn default() -> Self {
        CorePrefs { use_our_desktop: true }
    }
}

/// The saved preferences in `dir`, or the defaults when none are saved or the file is unreadable.
pub fn load(dir: &Path) -> CorePrefs {
    std::fs::read_to_string(dir.join(FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn save(dir: &Path, prefs: CorePrefs) -> std::io::Result<()> {
    let text = serde_json::to_vec_pretty(&prefs).map_err(std::io::Error::other)?;
    let tmp = dir.join(format!("{FILE}.tmp"));
    std::fs::write(&tmp, text)?;
    std::fs::rename(tmp, dir.join(FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_desktop_is_ours_until_switched_off_and_the_choice_persists() {
        let dir = tempfile::tempdir().expect("tmp");
        assert!(load(dir.path()).use_our_desktop, "default");
        save(dir.path(), CorePrefs { use_our_desktop: false }).expect("save");
        assert!(!load(dir.path()).use_our_desktop);
        std::fs::write(dir.path().join(FILE), "not json").expect("corrupt");
        assert!(load(dir.path()).use_our_desktop, "an unreadable file falls back to the default");
    }
}

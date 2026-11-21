//! What happens the first time dotDock starts on a machine, and never again: the default wallpaper.
//!
//! A person who installs dotDock sees its own wallpaper, the wind-swept meadow, from the first start.
//! Nobody who has run dotDock before is touched: their wallpaper is theirs, whatever it is.
//!
//! "First time" is decided by [`claim`], from the app data folder, before any window exists (the
//! first window creates the web view's profile folder, which is one of the traces of an earlier run):
//! - the marker `first-run.json` exists: this has been decided already;
//! - or an earlier run left its traces, the web view's profile folder or the snapshot of the original
//!   Windows state: this is an existing user, and the marker is written without changing anything;
//! - otherwise it is a first start: the marker is written and the caller gets a [`FirstStart`], which
//!   applies the default wallpaper. `wallpaper::apply` snapshots the original first, so "Restore
//!   Windows desktop" still brings it back.
//!
//! The marker is written when the decision is made, not when the wallpaper is applied. A failed attempt
//! is not retried on the next start: by then the first start has created its traces, and a wallpaper
//! set later is the user's.

use crate::wallpaper::{self, ManifestEntry};
use std::path::{Path, PathBuf};

/// The wallpaper new installs start with: "Wind Meadow" in its dark variant, deep green grass with
/// dotted flowers, the one the website's Aurum preview shows. Its id and mode in `assets/wallpapers/manifest.json`.
pub const DEFAULT_WALLPAPER: &str = "meadow-dots";
pub const DEFAULT_MODE: &str = "dark";

const MARKER: &str = "first-run.json";
/// What an earlier run leaves in the app data folder.
const EARLIER_RUN: [&str; 2] = ["EBWebView", "windows-original.json"];

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// The default wallpaper is now on every monitor.
    Applied(String),
    /// There is no default wallpaper to apply (the resources are not installed, as in a dev run).
    NothingToApply,
    /// Windows would not take the wallpaper.
    Failed(String),
}

/// The default wallpaper among the bundled ones.
pub fn default_wallpaper(bundled: &[(ManifestEntry, PathBuf)]) -> Option<&(ManifestEntry, PathBuf)> {
    bundled.iter().find(|(entry, _)| entry.id == DEFAULT_WALLPAPER && entry.mode == DEFAULT_MODE)
}

fn write_marker(dir: &Path) {
    // A marker that cannot be written only means the next start looks again, and finds the traces of this one.
    let _ = std::fs::write(dir.join(MARKER), "{\"schema\":1}\n");
}

/// Proof that this is the first start on this machine.
#[derive(Debug)]
pub struct FirstStart(());

/// Decides, and remembers that it has decided. `Some` exactly once per machine, and never for a user
/// who has run dotDock before. Call it before the first window is created.
pub fn claim(dir: &Path) -> Option<FirstStart> {
    if dir.join(MARKER).exists() {
        return None;
    }
    let existing_user = EARLIER_RUN.iter().any(|trace| dir.join(trace).exists());
    write_marker(dir);
    (!existing_user).then_some(FirstStart(()))
}

impl FirstStart {
    /// Applies the default wallpaper from the bundled ones in `bundled_dir`. `apply` sets one wallpaper
    /// file on every monitor.
    pub fn apply_default(self, bundled_dir: &Path, apply: impl FnOnce(&Path) -> Result<(), String>) -> Outcome {
        let Ok(bundled) = wallpaper::bundled(bundled_dir) else { return Outcome::NothingToApply };
        match default_wallpaper(&bundled) {
            Some((entry, path)) => match apply(path) {
                Ok(()) => Outcome::Applied(entry.id.clone()),
                Err(reason) => Outcome::Failed(reason),
            },
            None => Outcome::NothingToApply,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn shipped() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../assets/wallpapers")
    }

    /// An `apply` that only records the file it was asked to set.
    fn recording(seen: &RefCell<Vec<PathBuf>>) -> impl FnOnce(&Path) -> Result<(), String> + '_ {
        move |path| {
            seen.borrow_mut().push(path.to_owned());
            Ok(())
        }
    }

    #[test]
    fn the_default_is_the_dark_wind_meadow_and_it_ships() {
        let bundled = wallpaper::bundled(&shipped()).expect("shipped manifest");
        let (entry, path) = default_wallpaper(&bundled).expect("the default is in the manifest");
        assert_eq!((entry.id.as_str(), entry.mode.as_str()), ("meadow-dots", "dark"));
        assert_eq!(entry.name, "Wind Meadow");
        assert!(path.is_file(), "{} is bundled", path.display());
    }

    #[test]
    fn a_first_start_applies_the_default_wallpaper_once() {
        let dir = tempfile::tempdir().expect("dir");
        let seen = RefCell::new(Vec::new());
        let first = claim(dir.path()).expect("a fresh machine is a first start");
        assert_eq!(first.apply_default(&shipped(), recording(&seen)), Outcome::Applied("meadow-dots".to_owned()));
        let applied = seen.borrow().clone();
        assert_eq!(applied.len(), 1);
        assert_eq!(applied[0].file_name().and_then(|n| n.to_str()), Some("meadow-dots-dark.jpg"));

        assert!(claim(dir.path()).is_none(), "the second start is not a first start");
    }

    #[test]
    fn the_decision_is_remembered_even_when_the_profile_folder_is_gone() {
        let dir = tempfile::tempdir().expect("dir");
        assert!(claim(dir.path()).is_some());
        assert!(dir.path().join(MARKER).is_file());
        assert!(claim(dir.path()).is_none());
        assert!(claim(dir.path()).is_none());
    }

    #[test]
    fn an_existing_user_is_never_a_first_start_whichever_trace_their_earlier_run_left() {
        for trace in EARLIER_RUN {
            let dir = tempfile::tempdir().expect("dir");
            std::fs::create_dir(dir.path().join(trace)).expect("trace");
            assert!(claim(dir.path()).is_none(), "{trace}");
            assert!(dir.path().join(MARKER).is_file(), "{trace}: decided for good");
        }
    }

    #[test]
    fn a_wallpaper_chosen_after_the_first_start_is_never_replaced() {
        let dir = tempfile::tempdir().expect("dir");
        let seen = RefCell::new(Vec::new());
        claim(dir.path()).expect("first start").apply_default(&shipped(), recording(&seen));
        // The first start made the web view's profile folder, and the user picked something else later.
        std::fs::create_dir(dir.path().join("EBWebView")).expect("profile");
        std::fs::remove_file(dir.path().join(MARKER)).expect("lost marker");
        assert!(claim(dir.path()).is_none());
        assert_eq!(seen.borrow().len(), 1);
    }

    #[test]
    fn the_logs_and_guards_of_the_current_start_do_not_count_as_an_earlier_run() {
        let dir = tempfile::tempdir().expect("dir");
        for file in ["boot.log", "crash-guard.json", "modules.json"] {
            std::fs::write(dir.path().join(file), "x").expect("file");
        }
        assert!(claim(dir.path()).is_some());
    }

    #[test]
    fn a_wallpaper_windows_refuses_is_reported_and_not_retried() {
        let dir = tempfile::tempdir().expect("dir");
        let first = claim(dir.path()).expect("first start");
        assert_eq!(
            first.apply_default(&shipped(), |_| Err("no desktop".to_owned())),
            Outcome::Failed("no desktop".to_owned())
        );
        assert!(claim(dir.path()).is_none());
    }

    #[test]
    fn without_bundled_wallpapers_nothing_is_applied() {
        let dir = tempfile::tempdir().expect("dir");
        let missing = dir.path().join("no-wallpapers-here");
        let seen = RefCell::new(Vec::new());
        let first = claim(dir.path()).expect("first start");
        assert_eq!(first.apply_default(&missing, recording(&seen)), Outcome::NothingToApply);
        assert!(seen.borrow().is_empty());
    }

    #[test]
    fn only_the_exact_default_counts_not_its_light_twin_or_another_style() {
        let entry = |id: &str, mode: &str| ManifestEntry {
            id: id.to_owned(),
            name: id.to_owned(),
            style: String::new(),
            mode: mode.to_owned(),
            file: format!("{id}-{mode}.jpg"),
            thumb: None,
            accent: String::new(),
        };
        let list = vec![
            (entry("meadow-dots", "light"), PathBuf::from("a")),
            (entry("bloom-dots", "dark"), PathBuf::from("b")),
        ];
        assert!(default_wallpaper(&list).is_none());
    }
}

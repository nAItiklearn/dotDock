//! Hands the desktop back to Windows when the dotDock theme is switched off, and takes it over again
//! when it is switched on.
//!
//! Off: what dotDock had set in Windows is recorded first (the wallpaper of every monitor, as private
//! copies of the files, and whether dotDock starts at sign-in), then Windows is restored exactly as
//! `tools/restore-windows.ps1` does it (taskbar, autostart, startup delay, wallpaper, auto-hide).
//! On: what Windows is showing is recorded too (the user may have picked a wallpaper of their own while
//! dotDock was off), then the recorded wallpapers go back on their monitors and launch at sign-in is
//! turned on again if it was on. The record is then removed, so it always describes the last time
//! dotDock was switched off. The next off restores Windows and then puts that Windows-side record back,
//! so the user's own choice survives the cycle instead of reverting to the wallpaper from before dotDock.
//!
//! The record lives in `desktop-handover.json` beside the Windows snapshot; the copies go into a new
//! numbered folder under `desktop-handover` each time, so the copies Windows is showing are never the
//! ones being replaced. A second "off" while a record exists keeps it: the desktop on screen is then
//! Windows' own, not dotDock's. A damaged record is never silently skipped: it is moved aside to
//! `desktop-handover.damaged.json`, so nothing is lost, and the error is returned.
//!
//! The Windows side is behind [`Desktop`], so the order and the failure cases are unit-tested.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::wallpaper::Fit;

pub const FILE: &str = "desktop-handover.json";
/// Private copies of dotDock's wallpapers: the originals may be files Windows overwrites.
const COPIES: &str = "desktop-handover";
/// Where a record that could not be read is moved, so the next record does not overwrite it.
const DAMAGED: &str = "desktop-handover.damaged.json";
/// What Windows was showing when dotDock took the desktop over, put back by the next off.
const WINDOWS_FILE: &str = "desktop-handover.windows.json";
const WINDOWS_COPIES: &str = "desktop-handover-windows";
const SCHEMA: u32 = 1;

/// The part of Windows that dotDock changes and hands back.
pub trait Desktop {
    /// The wallpaper file of every monitor, by device path. A monitor showing a solid colour is left out.
    fn wallpapers(&self) -> Result<Vec<(String, PathBuf)>, String>;
    /// Every monitor's device path, in the shell's order.
    fn monitors(&self) -> Result<Vec<String>, String>;
    /// How wallpapers are fitted to the screen; one setting for every monitor.
    fn fit(&self) -> Result<Fit, String>;
    fn set_wallpaper(&self, monitor: &str, file: &Path, fit: Fit) -> Result<(), String>;
    fn autostart_enabled(&self) -> bool;
    fn enable_autostart(&self) -> Result<(), String>;
    /// The same effect as `tools/restore-windows.ps1`.
    fn restore_windows(&self) -> Result<(), String>;
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MonitorWallpaper {
    pub monitor: String,
    pub file: PathBuf,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub schema: u32,
    pub wallpapers: Vec<MonitorWallpaper>,
    #[serde(default)]
    pub fit: Fit,
    pub autostart: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum HandoverError {
    #[error("dotDock's desktop could not be recorded: {0}")]
    Record(String),
    #[error("Windows could not be restored: {0}")]
    Restore(String),
    #[error("the record of dotDock's desktop could not be read: {0}")]
    Damaged(String),
    #[error("dotDock's desktop could not be put back: {0}")]
    TakeOver(String),
}

/// What switching the theme on put back.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct TakenOver {
    pub wallpapers: usize,
    pub autostart: bool,
    /// No record existed: dotDock was never switched off on this machine, so nothing was changed.
    pub nothing_recorded: bool,
    /// What Windows was showing was recorded, so the next off puts it back rather than the wallpaper
    /// from before dotDock. False when nothing was recorded or the recording failed.
    pub windows_kept: bool,
}

fn record_path(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

/// Write-then-rename, flushed, so a power cut leaves the old file or the new one, never half.
fn write_record(path: &Path, record: &Record) -> std::io::Result<()> {
    let path = path.to_owned();
    let tmp = path.with_extension("json.tmp");
    let mut file = std::fs::File::create(&tmp)?;
    file.write_all(&serde_json::to_vec_pretty(record)?)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(tmp, path)
}

fn read_record(dir: &Path) -> Result<Option<Record>, HandoverError> {
    read_record_at(&record_path(dir))
}

fn read_record_at(path: &Path) -> Result<Option<Record>, HandoverError> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|e| HandoverError::Damaged(e.to_string())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(HandoverError::Damaged(e.to_string())),
    }
}

/// Moves a record that cannot be read out of the way, keeping it for a person to look at.
fn set_aside(dir: &Path) {
    // Best effort: if even the rename fails, the next off overwrites the damaged file, which is no worse.
    let _ = std::fs::rename(record_path(dir), dir.join(DAMAGED));
}

/// A folder for this record's copies that no earlier record uses.
fn new_generation(copies: &Path) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(copies)?;
    let mut n: u32 = 0;
    loop {
        let candidate = copies.join(n.to_string());
        match std::fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => n += 1,
            Err(e) => return Err(e),
        }
    }
}

/// Removes every earlier generation of copies. Best effort: one Windows still holds goes next time.
fn forget_other_generations(copies: &Path, keep: &Path) {
    let Ok(entries) = std::fs::read_dir(copies) else { return };
    for entry in entries.flatten() {
        if entry.path() != keep {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Copies each wallpaper into `folder` under a name of its own; the same file shown on several
/// monitors is copied once. The sources may be earlier copies: they are left in place.
fn copy_wallpapers(folder: &Path, shown: &[(String, PathBuf)]) -> Result<Vec<MonitorWallpaper>, HandoverError> {
    let mut sources: Vec<&PathBuf> = Vec::new();
    let mut out = Vec::with_capacity(shown.len());
    for (monitor, file) in shown {
        let index = match sources.iter().position(|s| *s == file) {
            Some(i) => i,
            None => {
                sources.push(file);
                sources.len() - 1
            }
        };
        let name = match file.extension() {
            Some(ext) => format!("wallpaper-{index}.{}", ext.to_string_lossy()),
            None => format!("wallpaper-{index}"),
        };
        let copy = folder.join(name);
        if !copy.exists() {
            std::fs::copy(file, &copy).map_err(|e| HandoverError::Record(format!("{}: {e}", file.display())))?;
        }
        out.push(MonitorWallpaper { monitor: monitor.clone(), file: copy });
    }
    Ok(out)
}

/// Records what is on screen as dotDock's desktop, in a new generation of copies.
fn record(dir: &Path, desktop: &dyn Desktop) -> Result<(), HandoverError> {
    record_into(&record_path(dir), &dir.join(COPIES), desktop)
}

/// Records what is on screen into the record at `path`, with its copies in a new generation under `copies`.
fn record_into(path: &Path, copies: &Path, desktop: &dyn Desktop) -> Result<(), HandoverError> {
    let failed = |e: std::io::Error| HandoverError::Record(e.to_string());
    let shown = desktop.wallpapers().map_err(HandoverError::Record)?;
    let fit = desktop.fit().map_err(HandoverError::Record)?;
    let copies = copies.to_owned();
    let folder = new_generation(&copies).map_err(failed)?;
    let wallpapers = match copy_wallpapers(&folder, &shown) {
        Ok(wallpapers) => wallpapers,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&folder);
            return Err(e);
        }
    };
    write_record(path, &Record { schema: SCHEMA, wallpapers, fit, autostart: desktop.autostart_enabled() })
        .map_err(failed)?;
    forget_other_generations(&copies, &folder);
    Ok(())
}

/// Switching the theme off: records dotDock's desktop, then restores Windows. Call after every part
/// has stopped. Restoring runs even when recording failed: the user asked for Windows back, and the
/// recording error is still returned so Settings can say what will not come back.
pub fn hand_back(dir: &Path, desktop: &dyn Desktop) -> Result<(), HandoverError> {
    let recorded = match read_record(dir) {
        // Already handed back: what is on screen is Windows' own desktop, so the record stays as it is.
        Ok(Some(_)) => Ok(()),
        // Nothing recorded: the desktop on screen is dotDock's.
        Ok(None) => record(dir, desktop),
        // Damaged: what it described cannot come back, so it is kept aside and the screen recorded.
        Err(_) => {
            set_aside(dir);
            record(dir, desktop)
        }
    };
    desktop.restore_windows().map_err(HandoverError::Restore)?;
    put_back_windows_side(dir, desktop)?;
    recorded
}

/// After Windows is restored: the wallpapers Windows was showing when dotDock last took over, if recorded.
/// Used once, then forgotten; without it the restored wallpaper is the one from before dotDock.
fn put_back_windows_side(dir: &Path, desktop: &dyn Desktop) -> Result<(), HandoverError> {
    let path = dir.join(WINDOWS_FILE);
    let found = read_record_at(&path);
    // Whatever happens next, this record has had its one use.
    let forget = || std::fs::remove_file(&path).map_err(|e| HandoverError::Restore(e.to_string()));
    match found {
        Ok(None) => Ok(()),
        Ok(Some(record)) => {
            put_wallpapers(&record, desktop).map_err(HandoverError::Restore)?;
            forget()
        }
        Err(e) => {
            forget()?;
            Err(HandoverError::Restore(format!("your own Windows wallpaper could not be put back ({e})")))
        }
    }
}

/// Puts each recorded wallpaper on its monitor. A monitor that is no longer attached is skipped; one that
/// was not attached then gets the first wallpaper, so no screen is left out. Returns how many were set.
fn put_wallpapers(record: &Record, desktop: &dyn Desktop) -> Result<usize, String> {
    let attached = desktop.monitors()?;
    let fallback = record.wallpapers.iter().find(|w| w.file.is_file());
    let mut set = 0;
    for monitor in &attached {
        let own = record.wallpapers.iter().find(|w| &w.monitor == monitor && w.file.is_file());
        if let Some(wallpaper) = own.or(fallback) {
            desktop.set_wallpaper(monitor, &wallpaper.file, record.fit)?;
            set += 1;
        }
    }
    Ok(set)
}

/// Switching the theme on: puts dotDock's recorded desktop back. Call before the parts start.
/// A monitor that is no longer attached is skipped; a monitor that was not attached then gets the
/// first monitor's wallpaper, so no screen is left with the Windows one.
pub fn take_over(dir: &Path, desktop: &dyn Desktop) -> Result<TakenOver, HandoverError> {
    let record = match read_record(dir) {
        Ok(Some(record)) => record,
        Ok(None) => return Ok(TakenOver { nothing_recorded: true, ..TakenOver::default() }),
        Err(e) => {
            set_aside(dir);
            return Err(e);
        }
    };
    // Before anything changes: what Windows is showing now, which may be a wallpaper the user chose
    // while dotDock was off. When it cannot be recorded, any older Windows-side record is dropped, so
    // the next off falls back to the wallpaper from before dotDock rather than to a stale choice.
    let windows_path = dir.join(WINDOWS_FILE);
    let windows_kept = record_into(&windows_path, &dir.join(WINDOWS_COPIES), desktop).is_ok();
    if !windows_kept {
        let _ = std::fs::remove_file(&windows_path);
    }
    let set = put_wallpapers(&record, desktop).map_err(HandoverError::TakeOver)?;
    if record.autostart {
        desktop.enable_autostart().map_err(HandoverError::TakeOver)?;
    }
    // Used: the next "off" records afresh. The copies stay until then, because Windows may still
    // be reading them.
    std::fs::remove_file(record_path(dir)).map_err(|e| HandoverError::TakeOver(e.to_string()))?;
    Ok(TakenOver { wallpapers: set, autostart: record.autostart, nothing_recorded: false, windows_kept })
}

/// The real Windows desktop.
pub struct Windows;

impl Desktop for Windows {
    fn wallpapers(&self) -> Result<Vec<(String, PathBuf)>, String> {
        crate::wallpaper::assignments().map_err(|e| e.to_string())
    }

    fn monitors(&self) -> Result<Vec<String>, String> {
        crate::wallpaper::monitors().map_err(|e| e.to_string())
    }

    fn fit(&self) -> Result<Fit, String> {
        crate::wallpaper::fit().map_err(|e| e.to_string())
    }

    fn set_wallpaper(&self, monitor: &str, file: &Path, fit: Fit) -> Result<(), String> {
        crate::wallpaper::apply(file, Some(monitor), fit).map_err(|e| e.to_string())
    }

    fn autostart_enabled(&self) -> bool {
        crate::autostart::is_enabled()
    }

    fn enable_autostart(&self) -> Result<(), String> {
        crate::autostart::enable().map(|_| ()).map_err(|e| e.to_string())
    }

    fn restore_windows(&self) -> Result<(), String> {
        crate::restore::restore_windows().map(|_| ()).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::BTreeMap;

    /// A desktop in memory: two monitors, a wallpaper each, and a log of every change.
    struct Fake {
        walls: RefCell<BTreeMap<String, PathBuf>>,
        monitors: RefCell<Vec<String>>,
        autostart: RefCell<bool>,
        fit: RefCell<Fit>,
        windows_wallpaper: PathBuf,
        fail_restore: bool,
        fail_read: bool,
        log: RefCell<Vec<String>>,
    }

    impl Fake {
        fn new(dir: &Path) -> Self {
            let dotdock = dir.join("meadow.jpg");
            let other = dir.join("dunes.png");
            let windows = dir.join("windows.jpg");
            for (file, bytes) in [(&dotdock, b"meadow".as_slice()), (&other, b"dunes"), (&windows, b"windows")] {
                std::fs::write(file, bytes).expect("write wallpaper");
            }
            let walls = BTreeMap::from([("left".to_owned(), dotdock), ("right".to_owned(), other)]);
            Self {
                walls: RefCell::new(walls),
                monitors: RefCell::new(vec!["left".into(), "right".into()]),
                autostart: RefCell::new(true),
                fit: RefCell::new(Fit::Span),
                windows_wallpaper: windows,
                fail_restore: false,
                fail_read: false,
                log: RefCell::new(Vec::new()),
            }
        }

        fn shown(&self, monitor: &str) -> Vec<u8> {
            std::fs::read(&self.walls.borrow()[monitor]).expect("shown wallpaper is readable")
        }
    }

    impl Desktop for Fake {
        fn wallpapers(&self) -> Result<Vec<(String, PathBuf)>, String> {
            if self.fail_read {
                return Err("shell busy".into());
            }
            Ok(self.walls.borrow().iter().map(|(m, p)| (m.clone(), p.clone())).collect())
        }
        fn monitors(&self) -> Result<Vec<String>, String> {
            Ok(self.monitors.borrow().clone())
        }
        fn fit(&self) -> Result<Fit, String> {
            Ok(*self.fit.borrow())
        }
        fn set_wallpaper(&self, monitor: &str, file: &Path, fit: Fit) -> Result<(), String> {
            self.log.borrow_mut().push(format!("wallpaper {monitor}"));
            *self.fit.borrow_mut() = fit;
            self.walls.borrow_mut().insert(monitor.to_owned(), file.to_owned());
            Ok(())
        }
        fn autostart_enabled(&self) -> bool {
            *self.autostart.borrow()
        }
        fn enable_autostart(&self) -> Result<(), String> {
            self.log.borrow_mut().push("autostart on".into());
            *self.autostart.borrow_mut() = true;
            Ok(())
        }
        fn restore_windows(&self) -> Result<(), String> {
            self.log.borrow_mut().push("restore".into());
            if self.fail_restore {
                return Err("schtasks refused".into());
            }
            *self.autostart.borrow_mut() = false;
            *self.fit.borrow_mut() = Fit::Fill;
            let windows = self.windows_wallpaper.clone();
            self.walls.borrow_mut().values_mut().for_each(|w| *w = windows.clone());
            Ok(())
        }
    }

    #[test]
    fn off_records_the_desktop_then_restores_windows() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = Fake::new(dir.path());
        hand_back(dir.path(), &fake).expect("hand back");
        assert_eq!(*fake.log.borrow(), ["restore"]);
        assert_eq!(fake.shown("left"), b"windows");
        assert!(!fake.autostart_enabled());
        let record = read_record(dir.path()).expect("readable").expect("recorded");
        assert!(record.autostart);
        assert_eq!(record.wallpapers.len(), 2);
        assert!(record.wallpapers.iter().all(|w| w.file.starts_with(dir.path().join(COPIES))));
        assert_eq!(record.fit, Fit::Span);
    }

    #[test]
    fn on_puts_every_monitor_and_autostart_back_and_forgets_the_record() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = Fake::new(dir.path());
        hand_back(dir.path(), &fake).expect("hand back");
        let taken = take_over(dir.path(), &fake).expect("take over");
        assert_eq!(taken, TakenOver { wallpapers: 2, autostart: true, nothing_recorded: false, windows_kept: true });
        assert_eq!(fake.shown("left"), b"meadow");
        assert_eq!(fake.shown("right"), b"dunes");
        assert_eq!(*fake.fit.borrow(), Fit::Span, "the fit the user chose, not the default");
        assert!(fake.autostart_enabled());
        assert!(read_record(dir.path()).expect("readable").is_none());
    }

    #[test]
    fn the_copies_survive_the_originals_being_overwritten() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = Fake::new(dir.path());
        hand_back(dir.path(), &fake).expect("hand back");
        // Spotlight and slideshows rewrite the file Windows reported.
        std::fs::write(dir.path().join("meadow.jpg"), b"spotlight").expect("overwrite");
        take_over(dir.path(), &fake).expect("take over");
        assert_eq!(fake.shown("left"), b"meadow");
    }

    #[test]
    fn autostart_that_was_off_stays_off() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = Fake::new(dir.path());
        *fake.autostart.borrow_mut() = false;
        hand_back(dir.path(), &fake).expect("hand back");
        let taken = take_over(dir.path(), &fake).expect("take over");
        assert!(!taken.autostart);
        assert!(!fake.log.borrow().contains(&"autostart on".to_owned()));
    }

    #[test]
    fn a_second_off_keeps_the_first_record() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = Fake::new(dir.path());
        hand_back(dir.path(), &fake).expect("first");
        hand_back(dir.path(), &fake).expect("second");
        take_over(dir.path(), &fake).expect("take over");
        assert_eq!(fake.shown("left"), b"meadow", "not the Windows wallpaper the second off saw");
    }

    #[test]
    fn on_without_a_record_changes_nothing() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = Fake::new(dir.path());
        let taken = take_over(dir.path(), &fake).expect("take over");
        assert!(taken.nothing_recorded);
        assert!(fake.log.borrow().is_empty());
    }

    #[test]
    fn windows_is_restored_even_when_recording_fails() {
        let dir = tempfile::tempdir().expect("temp dir");
        let mut fake = Fake::new(dir.path());
        fake.fail_read = true;
        let result = hand_back(dir.path(), &fake);
        assert!(matches!(result, Err(HandoverError::Record(_))));
        assert_eq!(*fake.log.borrow(), ["restore"]);
        assert_eq!(fake.shown("left"), b"windows");
    }

    #[test]
    fn a_failed_restore_is_reported() {
        let dir = tempfile::tempdir().expect("temp dir");
        let mut fake = Fake::new(dir.path());
        fake.fail_restore = true;
        assert!(matches!(hand_back(dir.path(), &fake), Err(HandoverError::Restore(_))));
    }

    #[test]
    fn a_damaged_record_is_an_error_on_and_is_kept_aside() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = Fake::new(dir.path());
        std::fs::write(record_path(dir.path()), b"{not json").expect("write");
        assert!(matches!(take_over(dir.path(), &fake), Err(HandoverError::Damaged(_))));
        assert_eq!(std::fs::read(dir.path().join(DAMAGED)).expect("kept aside"), b"{not json");
        assert!(fake.log.borrow().is_empty());
        // The next on finds no record and changes nothing; the damaged one is still there to look at.
        assert!(take_over(dir.path(), &fake).expect("second on").nothing_recorded);
        assert!(dir.path().join(DAMAGED).exists());
    }

    #[test]
    fn off_over_a_damaged_record_keeps_it_aside_and_records_the_screen() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = Fake::new(dir.path());
        std::fs::write(record_path(dir.path()), b"{not json").expect("write");
        hand_back(dir.path(), &fake).expect("hand back");
        assert_eq!(std::fs::read(dir.path().join(DAMAGED)).expect("kept aside"), b"{not json");
        take_over(dir.path(), &fake).expect("take over");
        assert_eq!(fake.shown("left"), b"meadow");
    }

    #[test]
    fn two_full_cycles_bring_dotdock_back_both_times() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = Fake::new(dir.path());
        for cycle in 0..2 {
            hand_back(dir.path(), &fake).unwrap_or_else(|e| panic!("off {cycle}: {e}"));
            assert_eq!(fake.shown("left"), b"windows");
            take_over(dir.path(), &fake).unwrap_or_else(|e| panic!("on {cycle}: {e}"));
            assert_eq!(fake.shown("left"), b"meadow", "cycle {cycle}");
            assert_eq!(fake.shown("right"), b"dunes", "cycle {cycle}");
        }
        // Only the generation in use is kept.
        assert_eq!(std::fs::read_dir(dir.path().join(COPIES)).expect("copies").count(), 1);
    }

    #[test]
    fn a_new_monitor_gets_the_first_wallpaper_and_a_gone_one_is_skipped() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = Fake::new(dir.path());
        hand_back(dir.path(), &fake).expect("hand back");
        *fake.monitors.borrow_mut() = vec!["left".into(), "projector".into()];
        fake.walls.borrow_mut().remove("right");
        fake.walls.borrow_mut().insert("projector".into(), fake.windows_wallpaper.clone());
        let taken = take_over(dir.path(), &fake).expect("take over");
        assert_eq!(taken.wallpapers, 2);
        assert_eq!(fake.shown("projector"), b"meadow");
        assert!(!fake.walls.borrow().contains_key("right"));
    }

    #[test]
    fn one_file_on_two_monitors_is_copied_once() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = Fake::new(dir.path());
        let meadow = dir.path().join("meadow.jpg");
        fake.walls.borrow_mut().insert("right".into(), meadow);
        hand_back(dir.path(), &fake).expect("hand back");
        let generation = std::fs::read_dir(dir.path().join(COPIES)).expect("copies").flatten().next().expect("one");
        assert_eq!(std::fs::read_dir(generation.path()).expect("generation").count(), 1);
    }

    #[test]
    fn a_wallpaper_chosen_while_off_comes_back_on_the_next_off() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = Fake::new(dir.path());
        hand_back(dir.path(), &fake).expect("first off");
        // With dotDock off, the user picks a wallpaper of their own in Windows.
        let mine = dir.path().join("mine.jpg");
        std::fs::write(&mine, b"mine").expect("write");
        fake.walls.borrow_mut().values_mut().for_each(|w| *w = mine.clone());
        *fake.fit.borrow_mut() = Fit::Center;
        assert!(take_over(dir.path(), &fake).expect("on").windows_kept);
        assert_eq!(fake.shown("left"), b"meadow");
        hand_back(dir.path(), &fake).expect("second off");
        assert_eq!(fake.shown("left"), b"mine", "not the wallpaper from before dotDock");
        assert_eq!(fake.shown("right"), b"mine");
        assert_eq!(*fake.fit.borrow(), Fit::Center);
        assert!(!dir.path().join(WINDOWS_FILE).exists(), "used once");
        // A third cycle still brings dotDock back, then the same choice.
        take_over(dir.path(), &fake).expect("on again");
        assert_eq!(fake.shown("left"), b"meadow");
        hand_back(dir.path(), &fake).expect("third off");
        assert_eq!(fake.shown("left"), b"mine");
    }

    #[test]
    fn without_a_windows_side_record_off_shows_the_wallpaper_from_before_dotdock() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = Fake::new(dir.path());
        hand_back(dir.path(), &fake).expect("off");
        assert_eq!(fake.shown("left"), b"windows");
    }

    #[test]
    fn a_damaged_windows_side_record_is_reported_and_dropped() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = Fake::new(dir.path());
        std::fs::write(dir.path().join(WINDOWS_FILE), b"{not json").expect("write");
        assert!(matches!(hand_back(dir.path(), &fake), Err(HandoverError::Restore(_))));
        assert_eq!(fake.shown("left"), b"windows", "Windows is still restored");
        assert!(!dir.path().join(WINDOWS_FILE).exists());
    }

    #[test]
    fn the_record_format_is_stable() {
        let record = Record {
            schema: SCHEMA,
            wallpapers: vec![MonitorWallpaper { monitor: "m".into(), file: PathBuf::from("w.jpg") }],
            fit: Fit::Span,
            autostart: true,
        };
        let json = serde_json::to_string(&record).expect("serialises");
        assert_eq!(json, r#"{"schema":1,"wallpapers":[{"monitor":"m","file":"w.jpg"}],"fit":"span","autostart":true}"#);
    }
}

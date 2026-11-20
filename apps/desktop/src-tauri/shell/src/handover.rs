//! Hands the desktop back to Windows when the dotDock theme is switched off, and takes it over again
//! when it is switched on.
//!
//! Off: what dotDock had set in Windows is recorded first (the wallpaper of every monitor, as private
//! copies of the files, and whether dotDock starts at sign-in), then Windows is restored exactly as
//! `tools/restore-windows.ps1` does it (taskbar, autostart, startup delay, wallpaper, auto-hide).
//! On: the recorded wallpapers go back on their monitors and launch at sign-in is turned on again if
//! it was on. The record is then removed, so it always describes the last time dotDock was switched off.
//!
//! The record lives in `desktop-handover.json` beside the Windows snapshot. A second "off" while one
//! exists keeps it: the desktop on screen is then Windows' own, not dotDock's. A damaged record is an
//! error on "on", never a silent skip, and it is kept so nothing is lost.
//!
//! The Windows side is behind [`Desktop`], so the order and the failure cases are unit-tested.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

pub const FILE: &str = "desktop-handover.json";
/// Private copies of dotDock's wallpapers: the originals may be files Windows overwrites.
const COPIES: &str = "desktop-handover";
const SCHEMA: u32 = 1;

/// The part of Windows that dotDock changes and hands back.
pub trait Desktop {
    /// The wallpaper file of every monitor, by device path. A monitor showing a solid colour is left out.
    fn wallpapers(&self) -> Result<Vec<(String, PathBuf)>, String>;
    /// Every monitor's device path, in the shell's order.
    fn monitors(&self) -> Result<Vec<String>, String>;
    fn set_wallpaper(&self, monitor: &str, file: &Path) -> Result<(), String>;
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
}

fn record_path(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

/// Write-then-rename, flushed, so a power cut leaves the old file or the new one, never half.
fn write_record(dir: &Path, record: &Record) -> std::io::Result<()> {
    let path = record_path(dir);
    let tmp = path.with_extension("json.tmp");
    let mut file = std::fs::File::create(&tmp)?;
    file.write_all(&serde_json::to_vec_pretty(record)?)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(tmp, path)
}

fn read_record(dir: &Path) -> Result<Option<Record>, HandoverError> {
    match std::fs::read(record_path(dir)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|e| HandoverError::Damaged(e.to_string())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(HandoverError::Damaged(e.to_string())),
    }
}

/// Copies each wallpaper into the private folder under a name of its own; the same file shown on
/// several monitors is copied once.
fn copy_wallpapers(dir: &Path, shown: &[(String, PathBuf)]) -> Result<Vec<MonitorWallpaper>, HandoverError> {
    let copies = dir.join(COPIES);
    // Old copies belong to an earlier record, which "on" has already used and removed.
    if copies.exists() {
        std::fs::remove_dir_all(&copies).map_err(|e| HandoverError::Record(e.to_string()))?;
    }
    std::fs::create_dir_all(&copies).map_err(|e| HandoverError::Record(e.to_string()))?;
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
        let copy = copies.join(name);
        if !copy.exists() {
            std::fs::copy(file, &copy).map_err(|e| HandoverError::Record(format!("{}: {e}", file.display())))?;
        }
        out.push(MonitorWallpaper { monitor: monitor.clone(), file: copy });
    }
    Ok(out)
}

/// Switching the theme off: records dotDock's desktop, then restores Windows. Call after every part
/// has stopped. Restoring runs even when recording failed: the user asked for Windows back, and the
/// recording error is still returned so Settings can say what will not come back.
pub fn hand_back(dir: &Path, desktop: &dyn Desktop) -> Result<(), HandoverError> {
    let recorded = match read_record(dir) {
        // Already handed back: what is on screen is Windows' own desktop, so the record stays as it is.
        Ok(Some(_)) => Ok(()),
        // Nothing recorded, or a damaged record: the desktop on screen is dotDock's, so record it afresh.
        Ok(None) | Err(_) => {
            desktop.wallpapers().map_err(HandoverError::Record).and_then(|shown| copy_wallpapers(dir, &shown)).and_then(
                |wallpapers| {
                    let record = Record { schema: SCHEMA, wallpapers, autostart: desktop.autostart_enabled() };
                    write_record(dir, &record).map_err(|e| HandoverError::Record(e.to_string()))
                },
            )
        }
    };
    desktop.restore_windows().map_err(HandoverError::Restore)?;
    recorded
}

/// Switching the theme on: puts dotDock's recorded desktop back. Call before the parts start.
/// A monitor that is no longer attached is skipped; a monitor that was not attached then gets the
/// first monitor's wallpaper, so no screen is left with the Windows one.
pub fn take_over(dir: &Path, desktop: &dyn Desktop) -> Result<TakenOver, HandoverError> {
    let Some(record) = read_record(dir)? else {
        return Ok(TakenOver { nothing_recorded: true, ..TakenOver::default() });
    };
    let attached = desktop.monitors().map_err(HandoverError::TakeOver)?;
    let fallback = record.wallpapers.iter().find(|w| w.file.is_file());
    let mut set = 0;
    for monitor in &attached {
        let own = record.wallpapers.iter().find(|w| &w.monitor == monitor && w.file.is_file());
        if let Some(wallpaper) = own.or(fallback) {
            desktop.set_wallpaper(monitor, &wallpaper.file).map_err(HandoverError::TakeOver)?;
            set += 1;
        }
    }
    if record.autostart {
        desktop.enable_autostart().map_err(HandoverError::TakeOver)?;
    }
    // Used: the next "off" records afresh. The copies stay until then, because Windows may still
    // be reading them.
    std::fs::remove_file(record_path(dir)).map_err(|e| HandoverError::TakeOver(e.to_string()))?;
    Ok(TakenOver { wallpapers: set, autostart: record.autostart, nothing_recorded: false })
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

    fn set_wallpaper(&self, monitor: &str, file: &Path) -> Result<(), String> {
        crate::wallpaper::apply(file, Some(monitor), crate::wallpaper::Fit::default()).map_err(|e| e.to_string())
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
        fn set_wallpaper(&self, monitor: &str, file: &Path) -> Result<(), String> {
            self.log.borrow_mut().push(format!("wallpaper {monitor}"));
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
    }

    #[test]
    fn on_puts_every_monitor_and_autostart_back_and_forgets_the_record() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = Fake::new(dir.path());
        hand_back(dir.path(), &fake).expect("hand back");
        let taken = take_over(dir.path(), &fake).expect("take over");
        assert_eq!(taken, TakenOver { wallpapers: 2, autostart: true, nothing_recorded: false });
        assert_eq!(fake.shown("left"), b"meadow");
        assert_eq!(fake.shown("right"), b"dunes");
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
    fn a_damaged_record_is_an_error_and_is_kept() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = Fake::new(dir.path());
        std::fs::write(record_path(dir.path()), b"{not json").expect("write");
        assert!(matches!(take_over(dir.path(), &fake), Err(HandoverError::Damaged(_))));
        assert!(record_path(dir.path()).exists());
        assert!(fake.log.borrow().is_empty());
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
        let copies = std::fs::read_dir(dir.path().join(COPIES)).expect("copies").count();
        assert_eq!(copies, 1);
    }

    #[test]
    fn the_record_format_is_stable() {
        let record = Record {
            schema: SCHEMA,
            wallpapers: vec![MonitorWallpaper { monitor: "m".into(), file: PathBuf::from("w.jpg") }],
            autostart: true,
        };
        let json = serde_json::to_string(&record).expect("serialises");
        assert_eq!(json, r#"{"schema":1,"wallpapers":[{"monitor":"m","file":"w.jpg"}],"autostart":true}"#);
    }
}

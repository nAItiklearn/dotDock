//! Records the user's original Windows state once, before the first shell change.
//! Same file and schema as `tools/snapshot-windows.ps1`, which `tools/restore-windows.ps1` reads.

use crate::{app_data_dir, AUTOSTART_NAME, RUN_KEY, SERIALIZE_KEY, STARTUP_DELAY_VALUE};
use crate::{registry, taskbar};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const DESKTOP_KEY: &str = r"Control Panel\Desktop";
const ADVANCED_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";
const FILE_NAME: &str = "windows-original.json";
const SCHEMA: u32 = 1;

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub schema: u32,
    pub taken_at: String,
    pub wallpaper: Option<String>,
    pub wallpaper_copy: Option<String>,
    pub wallpaper_style: Option<String>,
    pub tile_wallpaper: Option<String>,
    pub hide_icons_registry: Option<u32>,
    /// Seen on screen when the snapshot was taken; null when the desktop was not Explorer's.
    pub desktop_icons_visible: Option<bool>,
    pub serialize_key_existed: bool,
    pub startup_delay_in_m_sec: Option<u32>,
    pub run_entry_existed: bool,
    /// Original "Automatically hide the taskbar". Absent in snapshots from before the dock phase.
    #[serde(default)]
    pub taskbar_auto_hide: Option<bool>,
    #[serde(default)]
    pub taskbar_visible: Option<bool>,
}

#[derive(Debug, thiserror::Error)]
pub enum SnapshotError {
    #[error(transparent)]
    Registry(#[from] registry::RegistryError),
    #[error("snapshot file: {0}")]
    Io(#[from] std::io::Error),
    #[error("snapshot json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("LOCALAPPDATA is not set")]
    NoAppData,
    #[error("refusing to take a first snapshot while dotDock autostart is already active: the current state is not the original")]
    AlreadyModified,
}

pub fn path() -> Option<PathBuf> {
    app_data_dir().map(|d| d.join(FILE_NAME))
}

/// Ok(None) only when no snapshot exists. One that exists but cannot be read is an error,
/// never "nothing to restore": silently skipping would leave the user's system changed.
pub fn load() -> Result<Option<Snapshot>, SnapshotError> {
    let path = path().ok_or(SnapshotError::NoAppData)?;
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    // The PowerShell writer adds a UTF-8 byte-order mark.
    Ok(Some(serde_json::from_str(text.trim_start_matches('\u{feff}'))?))
}

/// Writes the snapshot if none exists. Never overwrites: the first one is the true original.
/// `autostart_active` guards against recording an already-modified state as the original.
pub fn ensure(autostart_active: bool) -> Result<(), SnapshotError> {
    let path = path().ok_or(SnapshotError::NoAppData)?;
    if path.exists() {
        return Ok(());
    }
    if autostart_active || registry::get_string(RUN_KEY, AUTOSTART_NAME)?.is_some() {
        return Err(SnapshotError::AlreadyModified);
    }
    let wallpaper = registry::get_string(DESKTOP_KEY, "WallPaper")?.filter(|w| !w.is_empty());
    let wallpaper_copy = wallpaper.as_deref().and_then(|w| copy_wallpaper(w, &path));
    let snapshot = Snapshot {
        schema: SCHEMA,
        taken_at: humantime_now(),
        wallpaper,
        wallpaper_copy,
        wallpaper_style: registry::get_string(DESKTOP_KEY, "WallpaperStyle")?,
        tile_wallpaper: registry::get_string(DESKTOP_KEY, "TileWallpaper")?,
        hide_icons_registry: registry::get_dword(ADVANCED_KEY, "HideIcons")?,
        desktop_icons_visible: crate::desktop_icons::visible(),
        serialize_key_existed: registry::key_exists(SERIALIZE_KEY)?,
        startup_delay_in_m_sec: registry::get_dword(SERIALIZE_KEY, STARTUP_DELAY_VALUE)?,
        run_entry_existed: registry::get_string(RUN_KEY, AUTOSTART_NAME)?.is_some(),
        taskbar_auto_hide: Some(taskbar::auto_hide()),
        taskbar_visible: taskbar::is_visible(),
    };
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&snapshot)?)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// Private copy so a restore still works if the user later deletes the original image.
fn copy_wallpaper(original: &str, snapshot_path: &std::path::Path) -> Option<String> {
    let src = PathBuf::from(original);
    // Extensionless sources exist (Spotlight and slideshow write `TranscodedWallpaper`), and they
    // are exactly the files Windows overwrites later, so they need the private copy most.
    let name = match src.extension() {
        Some(ext) => format!("original-wallpaper.{}", ext.to_string_lossy()),
        None => "original-wallpaper".to_owned(),
    };
    let dest = snapshot_path.with_file_name(name);
    std::fs::copy(&src, &dest).ok()?;
    Some(dest.to_string_lossy().into_owned())
}

/// Seconds since the Unix epoch; the restore script only needs it for humans reading the file.
fn humantime_now() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("unix:{secs}")
}

#[cfg(test)]
mod tests {
    use super::Snapshot;

    /// A snapshot written before the dock phase has no taskbar fields and must still load.
    #[test]
    fn loads_a_snapshot_without_taskbar_fields() {
        let old = r#"{"schema":1,"takenAt":"t","wallpaper":null,"wallpaperCopy":null,"wallpaperStyle":"10",
            "tileWallpaper":"0","hideIconsRegistry":1,"desktopIconsVisible":false,"serializeKeyExisted":false,
            "startupDelayInMSec":null,"runEntryExisted":false}"#;
        let snap: Snapshot = serde_json::from_str(old).expect("old snapshot parses");
        assert_eq!(snap.taskbar_auto_hide, None);
        assert_eq!(snap.taskbar_visible, None);
    }

    #[test]
    fn reads_taskbar_fields_written_by_the_script() {
        let new = r#"{"schema":1,"takenAt":"t","wallpaper":null,"wallpaperCopy":null,"wallpaperStyle":null,
            "tileWallpaper":null,"hideIconsRegistry":null,"desktopIconsVisible":null,"serializeKeyExisted":false,
            "startupDelayInMSec":null,"runEntryExisted":false,"taskbarAutoHide":true,"taskbarVisible":true}"#;
        let snap: Snapshot = serde_json::from_str(new).expect("new snapshot parses");
        assert_eq!(snap.taskbar_auto_hide, Some(true));
        assert_eq!(snap.taskbar_visible, Some(true));
    }
}

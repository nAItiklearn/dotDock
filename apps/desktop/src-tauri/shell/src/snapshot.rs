//! Records the user's original Windows state once, before the first shell change.
//! Same file and schema as `tools/snapshot-windows.ps1`, which `tools/restore-windows.ps1` reads.

use crate::registry;
use crate::{app_data_dir, AUTOSTART_NAME, RUN_KEY, SERIALIZE_KEY, STARTUP_DELAY_VALUE};
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
    /// Unknown from Rust without enumerating windows; restore skips a null.
    pub desktop_icons_visible: Option<bool>,
    pub serialize_key_existed: bool,
    pub startup_delay_in_m_sec: Option<u32>,
    pub run_entry_existed: bool,
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
}

pub fn path() -> Option<PathBuf> {
    app_data_dir().map(|d| d.join(FILE_NAME))
}

pub fn load() -> Option<Snapshot> {
    let text = std::fs::read_to_string(path()?).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

/// Writes the snapshot if none exists. Never overwrites: the first one is the true original.
pub fn ensure() -> Result<(), SnapshotError> {
    let path = path().ok_or(SnapshotError::NoAppData)?;
    if path.exists() {
        return Ok(());
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
        desktop_icons_visible: None,
        serialize_key_existed: registry::key_exists(SERIALIZE_KEY)?,
        startup_delay_in_m_sec: registry::get_dword(SERIALIZE_KEY, STARTUP_DELAY_VALUE)?,
        run_entry_existed: registry::get_string(RUN_KEY, AUTOSTART_NAME)?.is_some(),
    };
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&snapshot)?)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// Private copy so a restore still works if the user later deletes the original image.
fn copy_wallpaper(original: &str, snapshot_path: &std::path::Path) -> Option<String> {
    let src = PathBuf::from(original);
    let ext = src.extension()?.to_string_lossy().into_owned();
    let dest = snapshot_path.with_file_name(format!("original-wallpaper.{ext}"));
    std::fs::copy(&src, &dest).ok()?;
    Some(dest.to_string_lossy().into_owned())
}

/// Seconds since the Unix epoch; the restore script only needs it for humans reading the file.
fn humantime_now() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("unix:{secs}")
}

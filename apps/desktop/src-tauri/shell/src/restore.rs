//! Returns the desktop to the user's original Windows state from the snapshot. Same effect as
//! `tools/restore-windows.ps1`, but shipped inside the app so the uninstaller can always run it.

use crate::{autostart, dock_guard, registry, snapshot, taskbar};
use windows::core::HSTRING;
use windows::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_SETDESKWALLPAPER,
};

const DESKTOP_KEY: &str = r"Control Panel\Desktop";

#[derive(Debug, thiserror::Error)]
pub enum RestoreError {
    #[error(transparent)]
    Autostart(#[from] autostart::AutostartError),
    #[error(transparent)]
    Snapshot(#[from] snapshot::SnapshotError),
    #[error(transparent)]
    Registry(#[from] registry::RegistryError),
    #[error("windows refused the wallpaper change: {0}")]
    Wallpaper(windows::core::Error),
}

/// What restore did, for the log and the uninstaller's details.
#[derive(Debug, Default)]
pub struct Report {
    pub autostart_removed: bool,
    pub wallpaper_restored: Option<String>,
    pub had_snapshot: bool,
}

pub fn restore_windows() -> Result<Report, RestoreError> {
    let mut report = Report::default();
    // First and unconditional: a hidden taskbar is the one state a user cannot fix by hand.
    // `release` also drops the dock's marker, so no watcher restores it a second time.
    dock_guard::release();
    taskbar::show_all();
    autostart::disable()?;
    report.autostart_removed = true;

    let Some(snap) = snapshot::load()? else { return Ok(report) };
    report.had_snapshot = true;
    if let Some(on) = snap.taskbar_auto_hide {
        taskbar::set_auto_hide(on);
    }

    // Prefer the private copy: the original path may be a file Windows has since overwritten
    // (Spotlight and slideshow write to `TranscodedWallpaper`).
    let source = [snap.wallpaper_copy.as_deref(), snap.wallpaper.as_deref()]
        .into_iter()
        .flatten()
        .find(|p| std::path::Path::new(p).is_file());
    if let Some(style) = snap.wallpaper_style.as_deref() {
        registry::set_string(DESKTOP_KEY, "WallpaperStyle", style)?;
    }
    if let Some(tile) = snap.tile_wallpaper.as_deref() {
        registry::set_string(DESKTOP_KEY, "TileWallpaper", tile)?;
    }
    if let Some(path) = source {
        let wide = HSTRING::from(path);
        // SAFETY: SPI_SETDESKWALLPAPER reads a NUL-terminated wide string that outlives the call.
        unsafe {
            SystemParametersInfoW(
                SPI_SETDESKWALLPAPER,
                0,
                Some(wide.as_ptr() as *mut _),
                SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
            )
        }
        .map_err(RestoreError::Wallpaper)?;
        report.wallpaper_restored = Some(path.to_owned());
    }
    Ok(report)
}

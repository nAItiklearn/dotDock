//! Sets the real Windows wallpaper per monitor via `IDesktopWallpaper`. Because Windows itself
//! draws it, the user's wallpaper is on screen from the first frame of sign-in, before any app runs.

use crate::snapshot;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use windows::core::{HSTRING, PCWSTR, PWSTR};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    DesktopWallpaper, IDesktopWallpaper, DESKTOP_WALLPAPER_POSITION, DWPOS_CENTER, DWPOS_FILL, DWPOS_FIT, DWPOS_SPAN,
    DWPOS_STRETCH, DWPOS_TILE,
};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Fit {
    #[default]
    Fill,
    Fit,
    Stretch,
    Tile,
    Center,
    Span,
}

impl Fit {
    fn position(self) -> DESKTOP_WALLPAPER_POSITION {
        match self {
            Fit::Fill => DWPOS_FILL,
            Fit::Fit => DWPOS_FIT,
            Fit::Stretch => DWPOS_STRETCH,
            Fit::Tile => DWPOS_TILE,
            Fit::Center => DWPOS_CENTER,
            Fit::Span => DWPOS_SPAN,
        }
    }
}

/// One wallpaper as listed in `assets/wallpapers/manifest.json`.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub id: String,
    pub name: String,
    pub style: String,
    pub mode: String,
    pub file: String,
    /// 640x360 preview served by the UI (under assets/web), so pickers never decode 4K files.
    #[serde(default)]
    pub thumb: Option<String>,
    pub accent: String,
}

#[derive(Debug, thiserror::Error)]
pub enum WallpaperError {
    #[error("windows: {0}")]
    Windows(#[from] windows::core::Error),
    #[error("wallpaper file not found: {0}")]
    Missing(String),
    #[error(transparent)]
    Snapshot(#[from] snapshot::SnapshotError),
    #[error("manifest: {0}")]
    Manifest(String),
}

/// COM must be initialised on the calling thread; the guard undoes it.
struct ComGuard;

impl ComGuard {
    fn new() -> windows::core::Result<Self> {
        // SAFETY: paired with CoUninitialize in Drop on the same thread.
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.ok()?;
        Ok(Self)
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        // SAFETY: matches the successful CoInitializeEx in new().
        unsafe { CoUninitialize() };
    }
}

fn take_pwstr(p: PWSTR) -> String {
    // SAFETY: the shell allocated this string with CoTaskMemAlloc; we copy then free it once.
    unsafe {
        let s = p.to_string().unwrap_or_default();
        CoTaskMemFree(Some(p.0 as *const _));
        s
    }
}

/// Applies `path` to one monitor (device path from `monitors()`) or, with None, to every monitor.
pub fn apply(path: &Path, monitor: Option<&str>, fit: Fit) -> Result<(), WallpaperError> {
    if !path.is_file() {
        return Err(WallpaperError::Missing(path.display().to_string()));
    }
    // The original wallpaper must be on record before the first change, so restore always works.
    snapshot::ensure(false)?;
    let _com = ComGuard::new()?;
    // SAFETY: standard COM activation of the shell's wallpaper object; all calls use owned HSTRINGs.
    unsafe {
        let wp: IDesktopWallpaper = CoCreateInstance(&DesktopWallpaper, None, CLSCTX_LOCAL_SERVER)?;
        wp.SetPosition(fit.position())?;
        let file = HSTRING::from(path.as_os_str());
        match monitor {
            Some(id) => wp.SetWallpaper(&HSTRING::from(id), &file)?,
            None => wp.SetWallpaper(PCWSTR::null(), &file)?,
        }
    }
    Ok(())
}

/// Device paths of the attached monitors, in the shell's order.
pub fn monitors() -> Result<Vec<String>, WallpaperError> {
    let _com = ComGuard::new()?;
    // SAFETY: see apply(); each returned PWSTR is freed by take_pwstr.
    unsafe {
        let wp: IDesktopWallpaper = CoCreateInstance(&DesktopWallpaper, None, CLSCTX_LOCAL_SERVER)?;
        let count = wp.GetMonitorDevicePathCount()?;
        (0..count).map(|i| Ok(take_pwstr(wp.GetMonitorDevicePathAt(i)?))).collect()
    }
}

/// A monitor as the shell's wallpaper object knows it: its device path and desktop rectangle in
/// physical pixels (left, top, right, bottom).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MonitorRect {
    pub device_path: String,
    pub rect: (i32, i32, i32, i32),
}

/// Every attached monitor with its rectangle, so a display found by position can be given its own wallpaper.
pub fn monitor_rects() -> Result<Vec<MonitorRect>, WallpaperError> {
    let _com = ComGuard::new()?;
    // SAFETY: see apply(); each returned PWSTR is freed by take_pwstr, and the device path outlives the RECT query.
    unsafe {
        let wp: IDesktopWallpaper = CoCreateInstance(&DesktopWallpaper, None, CLSCTX_LOCAL_SERVER)?;
        let count = wp.GetMonitorDevicePathCount()?;
        (0..count)
            .map(|i| {
                let device_path = take_pwstr(wp.GetMonitorDevicePathAt(i)?);
                let r = wp.GetMonitorRECT(&HSTRING::from(device_path.as_str()))?;
                Ok(MonitorRect { device_path, rect: (r.left, r.top, r.right, r.bottom) })
            })
            .collect()
    }
}

/// The picture the user had before dotDock changed anything, from the snapshot: the private copy when it
/// still exists, else the original path.
pub fn original() -> Result<Option<PathBuf>, WallpaperError> {
    let Some(snap) = snapshot::load()? else { return Ok(None) };
    Ok([snap.wallpaper_copy, snap.wallpaper].into_iter().flatten().map(PathBuf::from).find(|p| p.is_file()))
}

#[derive(Deserialize)]
struct Manifest {
    wallpapers: Vec<ManifestEntry>,
}

/// Reads the bundled manifest and resolves each entry's absolute file path.
pub fn bundled(dir: &Path) -> Result<Vec<(ManifestEntry, PathBuf)>, WallpaperError> {
    let text =
        std::fs::read_to_string(dir.join("manifest.json")).map_err(|e| WallpaperError::Manifest(e.to_string()))?;
    let manifest: Manifest = serde_json::from_str(&text).map_err(|e| WallpaperError::Manifest(e.to_string()))?;
    Ok(manifest.wallpapers.into_iter().map(|e| (e.clone(), dir.join(&e.file))).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_shipped_manifest() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../assets/wallpapers");
        let all = bundled(&dir).expect("shipped manifest parses");
        assert!(all.len() >= 32, "16 wallpapers x dark/light");
        assert!(all.iter().all(|(_, p)| p.is_file()), "every manifest entry has its file");
    }

    #[test]
    fn fit_names_match_the_ui_contract() {
        let fit: Fit = serde_json::from_str("\"span\"").expect("kebab-case fit parses");
        assert_eq!(fit, Fit::Span);
        assert_eq!(serde_json::to_string(&Fit::Fill).expect("serialises"), "\"fill\"");
    }
}

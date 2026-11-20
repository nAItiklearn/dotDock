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
    /// The fit Windows reports; a position this build does not know reads as the default.
    fn from_position(position: DESKTOP_WALLPAPER_POSITION) -> Self {
        [Fit::Fill, Fit::Fit, Fit::Stretch, Fit::Tile, Fit::Center, Fit::Span]
            .into_iter()
            .find(|fit| fit.position() == position)
            .unwrap_or_default()
    }

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
    #[error("Windows is showing a solid colour, not a picture")]
    SolidColour,
    #[error("the wallpaper file is larger than {limit_mb} MB")]
    TooLarge { limit_mb: u64 },
    #[error("the wallpaper file could not be read: {0}")]
    Read(String),
}

/// Largest wallpaper file Settings is handed to read the colours of; a 4K PNG is about a tenth of this.
pub const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
const BYTES_PER_MB: u64 = 1024 * 1024;

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

/// How Windows fits wallpapers to the screen now; one setting for every monitor.
pub fn fit() -> Result<Fit, WallpaperError> {
    let _com = ComGuard::new()?;
    // SAFETY: see apply().
    let position = unsafe {
        let wp: IDesktopWallpaper = CoCreateInstance(&DesktopWallpaper, None, CLSCTX_LOCAL_SERVER)?;
        wp.GetPosition()?
    };
    Ok(Fit::from_position(position))
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

/// The wallpaper file of every monitor, by device path. Monitors showing a solid colour are left out.
pub fn assignments() -> Result<Vec<(String, PathBuf)>, WallpaperError> {
    let _com = ComGuard::new()?;
    // SAFETY: see apply(); each returned PWSTR is freed by take_pwstr.
    unsafe {
        let wp: IDesktopWallpaper = CoCreateInstance(&DesktopWallpaper, None, CLSCTX_LOCAL_SERVER)?;
        let mut out = Vec::new();
        for i in 0..wp.GetMonitorDevicePathCount()? {
            let id = take_pwstr(wp.GetMonitorDevicePathAt(i)?);
            let path = take_pwstr(wp.GetWallpaper(&HSTRING::from(id.as_str()))?);
            if !path.is_empty() {
                out.push((id, PathBuf::from(path)));
            }
        }
        Ok(out)
    }
}

/// The wallpaper file Windows is showing on the primary monitor: the one at the origin of the virtual
/// screen, or the first listed when none is. None when the wallpaper is a solid colour.
pub fn current() -> Result<Option<PathBuf>, WallpaperError> {
    let _com = ComGuard::new()?;
    // SAFETY: see apply(); each returned PWSTR is freed by take_pwstr.
    unsafe {
        let wp: IDesktopWallpaper = CoCreateInstance(&DesktopWallpaper, None, CLSCTX_LOCAL_SERVER)?;
        let ids = (0..wp.GetMonitorDevicePathCount()?)
            .map(|i| Ok(take_pwstr(wp.GetMonitorDevicePathAt(i)?)))
            .collect::<windows::core::Result<Vec<String>>>()?;
        let at_origin = ids.iter().find(|id| {
            wp.GetMonitorRECT(&HSTRING::from(id.as_str())).is_ok_and(|rect| rect.left == 0 && rect.top == 0)
        });
        let Some(id) = at_origin.or(ids.first()) else { return Ok(None) };
        let path = take_pwstr(wp.GetWallpaper(&HSTRING::from(id.as_str()))?);
        Ok((!path.is_empty()).then(|| PathBuf::from(path)))
    }
}

/// Reads a file, refusing one larger than `limit` bytes before reading any of it.
fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, WallpaperError> {
    let size = std::fs::metadata(path).map_err(|e| WallpaperError::Read(e.to_string()))?.len();
    if size > limit {
        return Err(WallpaperError::TooLarge { limit_mb: limit / BYTES_PER_MB });
    }
    std::fs::read(path).map_err(|e| WallpaperError::Read(e.to_string()))
}

/// The bytes of the picture Windows is showing as the wallpaper, so Settings can read its colours.
/// The path comes from Windows, never from the caller.
pub fn current_image() -> Result<Vec<u8>, WallpaperError> {
    let path = current()?.ok_or(WallpaperError::SolidColour)?;
    read_limited(&path, MAX_IMAGE_BYTES)
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
    fn a_file_over_the_limit_is_refused_and_one_at_the_limit_is_read() {
        let dir = tempfile::tempdir().expect("temp dir");
        let file = dir.path().join("wall.jpg");
        std::fs::write(&file, [7u8; 16]).expect("write");
        assert_eq!(read_limited(&file, 16).expect("at the limit"), vec![7u8; 16]);
        assert!(matches!(read_limited(&file, 15), Err(WallpaperError::TooLarge { .. })));
    }

    #[test]
    fn a_missing_file_is_a_read_error_not_a_panic() {
        let dir = tempfile::tempdir().expect("temp dir");
        assert!(matches!(read_limited(&dir.path().join("gone.jpg"), 16), Err(WallpaperError::Read(_))));
    }

    #[test]
    fn every_fit_reads_back_from_its_windows_position() {
        for fit in [Fit::Fill, Fit::Fit, Fit::Stretch, Fit::Tile, Fit::Center, Fit::Span] {
            assert_eq!(Fit::from_position(fit.position()), fit);
        }
    }

    #[test]
    fn fit_names_match_the_ui_contract() {
        let fit: Fit = serde_json::from_str("\"span\"").expect("kebab-case fit parses");
        assert_eq!(fit, Fit::Span);
        assert_eq!(serde_json::to_string(&Fit::Fill).expect("serialises"), "\"fill\"");
    }
}

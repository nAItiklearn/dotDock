//! Where the tiles keep their files and where they find the user's folders.

use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::Shell::{
    FOLDERID_Documents, FOLDERID_Downloads, FOLDERID_Pictures, SHGetKnownFolderPath, KF_FLAG_DEFAULT,
};

/// The user's Pictures subfolder where Windows (Win+PrtScn, Snipping Tool) and this crate save screenshots.
const SCREENSHOTS_DIR: &str = "Screenshots";
/// Voice memos live under Documents, where the user can find them, not hidden in app data.
const VOICE_MEMOS_DIR: &str = "dotDock Voice Memos";

/// Folder for the tiles' own files (shelf, contacts, settings, optional encrypted clipboard cache).
#[derive(Clone, Debug)]
pub struct DataDir(PathBuf);

impl DataDir {
    pub fn at(dir: impl Into<PathBuf>) -> Self {
        Self(dir.into())
    }

    pub fn settings(&self) -> PathBuf {
        self.0.join("tiles-settings.json")
    }

    pub fn shelf(&self) -> PathBuf {
        self.0.join("shelf.json")
    }

    pub fn contacts(&self) -> PathBuf {
        self.0.join("contacts.json")
    }

    pub fn clipboard_vault(&self) -> PathBuf {
        self.0.join("clipboard-history.bin")
    }

    pub fn colour_history(&self) -> PathBuf {
        self.0.join("colour-history.json")
    }

    pub fn stopwatch(&self) -> PathBuf {
        self.0.join("stopwatch.json")
    }

    pub fn hydration(&self) -> PathBuf {
        self.0.join("hydration.json")
    }
}

fn known_folder(id: &windows::core::GUID) -> Option<PathBuf> {
    // SAFETY: the returned string is CoTaskMem memory, copied and freed here.
    unsafe {
        let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
        let path = p.to_string().ok().map(PathBuf::from);
        CoTaskMemFree(Some(p.0 as *const _));
        path
    }
}

pub fn downloads() -> Option<PathBuf> {
    known_folder(&FOLDERID_Downloads)
}

pub fn screenshots() -> Option<PathBuf> {
    known_folder(&FOLDERID_Pictures).map(|p| p.join(SCREENSHOTS_DIR))
}

pub fn voice_memos() -> Option<PathBuf> {
    known_folder(&FOLDERID_Documents).map(|p| p.join(VOICE_MEMOS_DIR))
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// Writes through a temporary file and a rename, so a power cut leaves the old file or the new one, never half.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    }
    let temp = path.with_extension("tmp");
    let mut file = fs::File::create(&temp).map_err(|e| format!("could not write {}: {e}", temp.display()))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("could not write {}: {e}", temp.display()))?;
    drop(file);
    fs::rename(&temp, path).map_err(|e| format!("could not replace {}: {e}", path.display()))
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    write_atomic(path, &serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_survives_a_write_and_read() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("nested").join("x.json");
        write_json(&file, &vec![1, 2, 3]).unwrap();
        assert_eq!(read_json::<Vec<i32>>(&file), Some(vec![1, 2, 3]));
        write_json(&file, &vec![4]).unwrap();
        assert_eq!(read_json::<Vec<i32>>(&file), Some(vec![4]));
        assert!(!file.with_extension("tmp").exists());
    }

    #[test]
    fn the_known_folders_exist_on_this_machine() {
        assert!(downloads().is_some());
        assert!(screenshots().is_some());
        assert!(voice_memos().is_some());
    }

    #[test]
    fn a_missing_or_corrupt_file_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_json::<Vec<i32>>(&dir.path().join("none.json")), None);
        let bad = dir.path().join("bad.json");
        fs::write(&bad, b"{ not json").unwrap();
        assert_eq!(read_json::<Vec<i32>>(&bad), None);
    }
}

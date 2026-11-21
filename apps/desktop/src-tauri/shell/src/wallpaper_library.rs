//! The wallpapers the user brought in, and which wallpaper each display shows. Both live in
//! `<app data>\wallpapers\`: imported pictures are copied into `imported\` (so deleting the original
//! never breaks the desktop) and listed in `library.json`; per-display choices are in `assignments.json`.

use crate::wallpaper::Fit;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const LIBRARY_FILE: &str = "library.json";
const ASSIGNMENTS_FILE: &str = "assignments.json";
const IMPORTED_DIR: &str = "imported";
/// Pictures Windows can use as a wallpaper.
pub const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "bmp", "webp", "gif", "jfif"];
/// Prefix of imported wallpaper ids, so they never collide with bundled ones.
pub const IMPORTED_PREFIX: &str = "imported-";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub id: String,
    /// The original file name without its extension, as the user knows it.
    pub name: String,
    /// File name inside `imported\`.
    pub file: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Assignment {
    pub monitor_id: String,
    /// None means the user's original wallpaper from the snapshot.
    pub wallpaper_id: Option<String>,
    pub fit: Fit,
}

#[derive(Debug, thiserror::Error)]
pub enum LibraryError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("that file is not a picture Windows can use as a wallpaper")]
    NotAnImage,
    #[error("no imported wallpaper {0}")]
    Unknown(String),
    #[error("this wallpaper is on a display; choose another one for it first")]
    InUse,
}

/// The wallpapers folder; `root` is the app data folder.
pub struct Library {
    dir: PathBuf,
}

fn read_json<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> Result<T, LibraryError> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(serde_json::from_str(&text)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(e.into()),
    }
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), LibraryError> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| IMAGE_EXTENSIONS.iter().any(|ok| ok.eq_ignore_ascii_case(e)))
}

impl Library {
    pub fn open(root: &Path) -> Result<Library, LibraryError> {
        let dir = root.join("wallpapers");
        std::fs::create_dir_all(dir.join(IMPORTED_DIR))?;
        Ok(Library { dir })
    }

    pub fn imported(&self) -> Result<Vec<Imported>, LibraryError> {
        read_json(&self.dir.join(LIBRARY_FILE))
    }

    /// Absolute path of an imported wallpaper's file.
    pub fn path_of(&self, entry: &Imported) -> PathBuf {
        self.dir.join(IMPORTED_DIR).join(&entry.file)
    }

    pub fn find(&self, id: &str) -> Result<Imported, LibraryError> {
        self.imported()?.into_iter().find(|e| e.id == id).ok_or_else(|| LibraryError::Unknown(id.to_owned()))
    }

    /// Copies a picture into the library. Ids are unique and stable for the copy's lifetime.
    pub fn import(&self, source: &Path) -> Result<Imported, LibraryError> {
        if !source.is_file() || !is_image(source) {
            return Err(LibraryError::NotAnImage);
        }
        let mut entries = self.imported()?;
        let next = (1..).find(|n| !entries.iter().any(|e| e.id == format!("{IMPORTED_PREFIX}{n}"))).unwrap_or(1);
        let id = format!("{IMPORTED_PREFIX}{next}");
        let ext = source.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase();
        let file = format!("{id}.{ext}");
        std::fs::copy(source, self.dir.join(IMPORTED_DIR).join(&file))?;
        let name = source.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| id.clone());
        let entry = Imported { id, name, file };
        entries.push(entry.clone());
        write_json(&self.dir.join(LIBRARY_FILE), &entries)?;
        Ok(entry)
    }

    /// Deletes an imported wallpaper. Refused while a display shows it.
    pub fn remove(&self, id: &str) -> Result<(), LibraryError> {
        if self.assignments()?.iter().any(|a| a.wallpaper_id.as_deref() == Some(id)) {
            return Err(LibraryError::InUse);
        }
        let mut entries = self.imported()?;
        let index = entries.iter().position(|e| e.id == id).ok_or_else(|| LibraryError::Unknown(id.to_owned()))?;
        let entry = entries.remove(index);
        match std::fs::remove_file(self.path_of(&entry)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
            _ => {}
        }
        write_json(&self.dir.join(LIBRARY_FILE), &entries)
    }

    pub fn assignments(&self) -> Result<Vec<Assignment>, LibraryError> {
        read_json(&self.dir.join(ASSIGNMENTS_FILE))
    }

    /// Records what `monitors` now show, replacing their earlier entries.
    pub fn assign(
        &self,
        monitors: &[String],
        wallpaper_id: Option<&str>,
        fit: Fit,
    ) -> Result<Vec<Assignment>, LibraryError> {
        let mut all = self.assignments()?;
        all.retain(|a| !monitors.contains(&a.monitor_id));
        all.extend(monitors.iter().map(|m| Assignment {
            monitor_id: m.clone(),
            wallpaper_id: wallpaper_id.map(str::to_owned),
            fit,
        }));
        all.sort_by(|a, b| a.monitor_id.cmp(&b.monitor_id));
        write_json(&self.dir.join(ASSIGNMENTS_FILE), &all)?;
        Ok(all)
    }
}

/// The content type an imported picture is served with.
pub fn mime_of(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("png") => "image/png",
        Some("bmp") => "image/bmp",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "image/jpeg",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pictures_are_served_with_their_type() {
        assert_eq!(mime_of(Path::new("a.PNG")), "image/png");
        assert_eq!(mime_of(Path::new("a.jfif")), "image/jpeg");
    }

    fn picture(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, b"picture bytes").expect("write");
        path
    }

    #[test]
    fn importing_copies_the_picture_and_lists_it() {
        let root = tempfile::tempdir().expect("tmp");
        let lib = Library::open(root.path()).expect("open");
        let src = picture(root.path(), "Holiday Lake.JPG");
        let entry = lib.import(&src).expect("import");
        assert_eq!(entry.name, "Holiday Lake");
        assert!(entry.id.starts_with(IMPORTED_PREFIX));
        std::fs::remove_file(&src).expect("delete original");
        assert!(lib.path_of(&entry).is_file(), "the copy survives the original");
        assert_eq!(lib.imported().expect("list"), vec![entry.clone()]);
        let second = lib.import(&picture(root.path(), "b.png")).expect("second");
        assert_ne!(second.id, entry.id);
    }

    #[test]
    fn only_pictures_can_be_imported() {
        let root = tempfile::tempdir().expect("tmp");
        let lib = Library::open(root.path()).expect("open");
        assert!(matches!(lib.import(&picture(root.path(), "notes.txt")), Err(LibraryError::NotAnImage)));
        assert!(matches!(lib.import(&root.path().join("missing.jpg")), Err(LibraryError::NotAnImage)));
    }

    #[test]
    fn assignments_replace_per_display_and_block_removal() {
        let root = tempfile::tempdir().expect("tmp");
        let lib = Library::open(root.path()).expect("open");
        let entry = lib.import(&picture(root.path(), "a.jpg")).expect("import");
        let both = ["B".to_owned(), "A".to_owned()];
        lib.assign(&both, Some("louver-ember"), Fit::Fill).expect("assign");
        let after = lib.assign(&["A".to_owned()], Some(&entry.id), Fit::Fit).expect("assign one");
        assert_eq!(after.len(), 2);
        assert_eq!(
            after[0],
            Assignment { monitor_id: "A".into(), wallpaper_id: Some(entry.id.clone()), fit: Fit::Fit }
        );
        assert!(matches!(lib.remove(&entry.id), Err(LibraryError::InUse)));
        lib.assign(&["A".to_owned()], None, Fit::Fill).expect("back to original");
        lib.remove(&entry.id).expect("remove");
        assert!(!lib.path_of(&entry).exists());
        assert!(lib.imported().expect("list").is_empty());
        assert!(matches!(lib.remove(&entry.id), Err(LibraryError::Unknown(_))));
    }
}

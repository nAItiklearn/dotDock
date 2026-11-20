//! Icons for the dock: 256 px PNGs with alpha, extracted once and cached on disk.
//!
//! A cache file is named by the hash of what the icon was made from (id, modification time, extractor
//! version, size), so a warm start finds every icon by name and extracts nothing. Extraction runs on its own
//! thread (`IconWorker`) and never on the caller's.

mod assets;
mod image;
mod shell;
mod worker;

pub use assets::best_logo;
pub use image::{decode_png, encode_png, premultiplied_to_straight, Rgba};
pub use worker::{IconRequest, IconWorker};

use crate::util::{mtime_secs, stable_hash};
use std::io;
use std::path::{Path, PathBuf};

/// Edge in px the dock asks the shell for. The shell returns the largest real size it has; nothing is scaled up.
pub const ICON_SIZE: u32 = 256;
/// Bump when the extraction changes in a way that should refresh every cached icon.
pub const EXTRACTOR_VERSION: &str = "1";
/// Scheme of the URL the dock window loads icons from; the host serves it from the cache folder.
pub const URL_SCHEME: &str = "dock-icon://";
const FILE_EXTENSION: &str = "png";

/// Where an icon comes from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IconSource {
    /// An item in `shell:AppsFolder`, by its name there; the package folder, when there is one, supplies the
    /// logo files used if the shell's own icon is small.
    AppsFolder { id: String, package_dir: Option<PathBuf> },
    /// A file on disk: an executable or a shortcut.
    File(PathBuf),
}

impl IconSource {
    /// Where an app's icon can be read from, best first; the first that gives a real picture (not blank and
    /// not the shell's generic page) wins.
    ///
    /// A Store app asks the AppsFolder. A desktop app asks its shortcut first only when the shortcut names an
    /// icon file of its own that exists (a web app shortcut, say); otherwise its program, whose icon resources
    /// are the real thing: a shortcut whose icon file was uninstalled shows the shell's blank page. The
    /// AppsFolder comes last: the shell invents an id for shortcuts without an AppUserModelID and may answer
    /// that id with a blank page too.
    pub fn candidates(entry: &crate::catalogue::AppEntry) -> Vec<IconSource> {
        let apps_folder =
            |id: &str| IconSource::AppsFolder { id: id.to_owned(), package_dir: entry.package_dir.clone() };
        if entry.packaged() {
            return vec![apps_folder(entry.aumid.as_deref().unwrap_or(&entry.id))];
        }
        let shortcut = entry.shortcut.as_ref().map(|lnk| IconSource::File(lnk.clone()));
        let program = entry
            .target
            .as_deref()
            .filter(|t| Path::new(t).is_file())
            .map(|target| IconSource::File(PathBuf::from(target)));
        let mut out = Vec::new();
        if entry.icon_file.is_some() {
            out.extend(shortcut);
            out.extend(program);
        } else {
            out.extend(program);
            out.extend(shortcut);
        }
        if let Some(id) = entry.shell_id.as_deref().or(entry.aumid.as_deref()) {
            out.push(apps_folder(id));
        }
        out
    }
}

/// The name of an icon in the cache, derived from what it was made from.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct IconKey(String);

impl IconKey {
    /// `id` is the app id (or the executable path for a window with no catalogue entry); the modification
    /// time of the first source makes the key change when the app is updated.
    pub fn new(id: &str, sources: &[IconSource]) -> IconKey {
        let stamp = match sources.first() {
            Some(IconSource::AppsFolder { package_dir: Some(dir), .. }) => mtime_secs(&dir.join("AppxManifest.xml")),
            Some(IconSource::File(path)) => mtime_secs(path),
            Some(IconSource::AppsFolder { package_dir: None, .. }) | None => 0,
        };
        let hash = stable_hash(&[id, &stamp.to_string(), EXTRACTOR_VERSION, &ICON_SIZE.to_string()]);
        IconKey(format!("{hash:016x}"))
    }

    pub fn from_hash(hash: &str) -> Option<IconKey> {
        (hash.len() == 16 && hash.bytes().all(|b| b.is_ascii_hexdigit())).then(|| IconKey(hash.to_ascii_lowercase()))
    }

    pub fn hash(&self) -> &str {
        &self.0
    }

    /// `dock-icon://<hash>.png`
    pub fn url(&self) -> String {
        format!("{URL_SCHEME}{}.{FILE_EXTENSION}", self.0)
    }

    pub fn file_name(&self) -> String {
        format!("{}.{FILE_EXTENSION}", self.0)
    }
}

/// The key a `dock-icon://` URL names, or `None` for a URL that is not ours or not well formed. The host
/// calls this before touching the disk, so a crafted URL can never name a path outside the cache folder.
pub fn key_from_url(url: &str) -> Option<IconKey> {
    let name = url.strip_prefix(URL_SCHEME)?.trim_end_matches('/');
    let hash = name.strip_suffix(&format!(".{FILE_EXTENSION}"))?;
    IconKey::from_hash(hash)
}

/// The folder the icons live in: `<local app data>\dev.dotdock.desktop\dock-icons`.
pub fn default_cache_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join(APP_FOLDER).join(CACHE_FOLDER))
}
const APP_FOLDER: &str = "dev.dotdock.desktop";
const CACHE_FOLDER: &str = "dock-icons";

/// Where `key` lives in `dir`.
pub fn cache_path(dir: &Path, key: &IconKey) -> PathBuf {
    dir.join(key.file_name())
}

/// True when the icon is already cached.
pub fn is_cached(dir: &Path, key: &IconKey) -> bool {
    cache_path(dir, key).is_file()
}

/// Writes `bytes` to `path` atomically: a reader sees the old file or the new one, never half of one.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_changes_with_the_id_and_the_file() {
        let source = || [IconSource::File("C:\\does\\not\\exist.exe".into())];
        let a = IconKey::new("id-a", &source());
        let b = IconKey::new("id-b", &source());
        assert_ne!(a, b);
        assert_eq!(a, IconKey::new("id-a", &source()));
    }

    #[test]
    fn key_changes_when_the_file_is_touched() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("app.exe");
        std::fs::write(&file, b"x").unwrap();
        let before = IconKey::new("app", &[IconSource::File(file.clone())]);
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(5);
        std::fs::File::options().write(true).open(&file).unwrap().set_modified(later).unwrap();
        assert_ne!(before, IconKey::new("app", &[IconSource::File(file)]));
    }

    #[test]
    fn url_round_trips() {
        let key = IconKey::new("x", &[IconSource::File("C:\\x.exe".into())]);
        assert!(key.url().starts_with("dock-icon://"));
        assert_eq!(key_from_url(&key.url()), Some(key));
    }

    #[test]
    fn urls_that_are_not_ours_name_no_file() {
        for url in [
            "dock-icon://../../secrets.png",
            "dock-icon://..%2Fsecrets.png",
            "dock-icon://zzzzzzzzzzzzzzzz.png",
            "dock-icon://0123456789abcdef.exe",
            "dock-icon://0123456789abcde.png",
            "https://0123456789abcdef.png",
            "dock-icon://",
        ] {
            assert_eq!(key_from_url(url), None, "{url}");
        }
        assert!(key_from_url("dock-icon://0123456789abcdef.png").is_some());
        assert!(key_from_url("dock-icon://0123456789ABCDEF.png/").is_some());
    }

    #[test]
    fn atomic_write_replaces_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.png");
        write_atomic(&path, b"one").unwrap();
        write_atomic(&path, b"two").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"two");
        assert!(!dir.path().join("a.tmp").exists());
    }
}

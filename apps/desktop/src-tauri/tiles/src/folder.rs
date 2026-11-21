//! A watched folder shown as "newest first": the Downloads folder and the screenshots folder.
//!
//! While subscribed, one thread sleeps on Windows' directory change notification (`ReadDirectoryChangesW`, through
//! the `notify` crate) and rescans when the folder changes, folding bursts of events into one scan. A growing
//! download produces events all the time, so a scan happens at most once per `BURST_CAP`.

use crate::com::{coalesce_capped, Refresh, Worker};
use crate::emit::{lock, shared, Emitter, Shared};
use crate::protocol::{FileItem, FolderState, TileData, TileId};
use notify::{RecursiveMode, Watcher};
use std::fs;
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, UNIX_EPOCH};

/// Files listed in the Downloads tile.
pub const DOWNLOADS_LIMIT: usize = 20;
/// Files listed in the Screenshots tile.
pub const SCREENSHOTS_LIMIT: usize = 12;
/// Wait for this much quiet after a change before scanning...
const QUIET: Duration = Duration::from_millis(250);
/// ...but never wait longer than this while changes keep arriving.
const BURST_CAP: Duration = Duration::from_millis(1500);
/// `FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM`.
const HIDDEN_OR_SYSTEM: u32 = 0x2 | 0x4;
/// Extensions browsers and downloaders use for files still being written.
const PARTIAL_EXTENSIONS: [&str; 7] = ["crdownload", "part", "partial", "tmp", "download", "opdownload", "!qb"];
/// What counts as a screenshot.
const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "bmp", "gif", "webp"];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Downloads,
    Screenshots,
}

impl Kind {
    fn tile(self) -> TileId {
        match self {
            Kind::Downloads => TileId::Downloads,
            Kind::Screenshots => TileId::Screenshots,
        }
    }

    fn limit(self) -> usize {
        match self {
            Kind::Downloads => DOWNLOADS_LIMIT,
            Kind::Screenshots => SCREENSHOTS_LIMIT,
        }
    }

    fn wrap(self, state: FolderState) -> TileData {
        match self {
            Kind::Downloads => TileData::Downloads(state),
            Kind::Screenshots => TileData::Screenshots(state),
        }
    }
}

fn extension(name: &str) -> String {
    Path::new(name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn wanted(kind: Kind, name: &str, is_dir: bool) -> bool {
    if name.starts_with('.') || name.eq_ignore_ascii_case("desktop.ini") || name.eq_ignore_ascii_case("thumbs.db") {
        return false;
    }
    match kind {
        Kind::Downloads => true,
        Kind::Screenshots => !is_dir && IMAGE_EXTENSIONS.contains(&extension(name).as_str()),
    }
}

/// Lists the newest entries of a folder.
pub fn scan(kind: Kind, folder: &Path) -> FolderState {
    let mut state = FolderState { folder: folder.to_string_lossy().into_owned(), items: Vec::new(), problem: None };
    let read = match fs::read_dir(folder) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return state,
        Err(e) => {
            state.problem = Some(format!("Could not read the folder: {e}"));
            return state;
        }
    };
    let mut items: Vec<FileItem> = read
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let meta = entry.metadata().ok()?;
            if meta.file_attributes() & HIDDEN_OR_SYSTEM != 0 {
                return None;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if !wanted(kind, &name, meta.is_dir()) {
                return None;
            }
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
                .unwrap_or(0);
            Some(FileItem {
                path: entry.path().to_string_lossy().into_owned(),
                partial: !meta.is_dir() && PARTIAL_EXTENSIONS.contains(&extension(&name).as_str()),
                name,
                modified_ms,
                size_bytes: if meta.is_dir() { 0 } else { meta.len() },
                is_dir: meta.is_dir(),
            })
        })
        .collect();
    items.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then_with(|| a.name.cmp(&b.name)));
    items.truncate(kind.limit());
    state.items = items;
    state
}

pub struct FolderProvider {
    kind: Kind,
    folder: Option<PathBuf>,
    emitter: Emitter,
    state: Shared<Option<FolderState>>,
    worker: Mutex<Option<Worker<Refresh>>>,
}

impl FolderProvider {
    pub fn new(kind: Kind, folder: Option<PathBuf>, emitter: Emitter) -> Self {
        Self { kind, folder, emitter, state: shared(None), worker: Mutex::new(None) }
    }

    fn unavailable(&self) -> FolderState {
        FolderState {
            folder: String::new(),
            items: Vec::new(),
            problem: Some("Windows did not say where this folder is".to_owned()),
        }
    }

    pub fn start(&self) -> Result<(), String> {
        let mut slot = lock(&self.worker);
        if slot.is_some() {
            return Ok(());
        }
        let Some(folder) = self.folder.clone() else {
            *lock(&self.state) = Some(self.unavailable());
            return Ok(());
        };
        let (kind, state, emitter) = (self.kind, self.state.clone(), self.emitter.clone());
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let worker = Worker::spawn(&format!("tiles-{:?}", self.kind).to_lowercase(), move |rx, tx| {
            let notify_tx = tx.clone();
            let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                if event.is_ok() {
                    // The worker is gone only while shutting down.
                    let _ = notify_tx.send(Some(Refresh));
                }
            })
            .ok();
            let parent = folder.parent().map(Path::to_path_buf);
            // A folder that does not exist yet (no screenshot taken so far) is awaited through its parent.
            let mut watching_folder = false;
            let mut ready = Some(ready_tx);
            loop {
                if !watching_folder {
                    if let Some(w) = watcher.as_mut() {
                        if folder.is_dir() {
                            watching_folder = w.watch(&folder, RecursiveMode::NonRecursive).is_ok();
                            if watching_folder {
                                if let Some(p) = &parent {
                                    let _ = w.unwatch(p);
                                }
                            }
                        } else if let Some(p) = &parent {
                            let _ = w.watch(p, RecursiveMode::NonRecursive);
                        }
                    }
                }
                let next = scan(kind, &folder);
                if lock(&state).as_ref() != Some(&next) {
                    *lock(&state) = Some(next.clone());
                    emitter.emit(kind.wrap(next));
                }
                if let Some(tx) = ready.take() {
                    let _ = tx.send(());
                }
                match rx.recv() {
                    Ok(Some(_)) => {
                        if !coalesce_capped(&rx, QUIET, BURST_CAP) {
                            break;
                        }
                    }
                    _ => break,
                }
            }
        })
        .map_err(|e| format!("could not start the {:?} watcher: {e}", self.kind))?;
        *slot = Some(worker);
        drop(slot);
        let _ = ready_rx.recv_timeout(Duration::from_secs(3));
        Ok(())
    }

    pub fn stop(&self) {
        let worker = lock(&self.worker).take();
        drop(worker);
        *lock(&self.state) = None;
    }

    pub fn state(&self) -> FolderState {
        match (&self.folder, lock(&self.state).clone()) {
            (_, Some(state)) => state,
            (Some(folder), None) => scan(self.kind, folder),
            (None, None) => self.unavailable(),
        }
    }

    pub fn tile(&self) -> TileId {
        self.kind.tile()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::SystemTime;

    fn touch(dir: &Path, name: &str, age_secs: u64) {
        let path = dir.join(name);
        fs::File::create(&path).unwrap().write_all(b"x").unwrap();
        let when = SystemTime::now() - Duration::from_secs(age_secs);
        fs::File::options().write(true).open(&path).unwrap().set_modified(when).unwrap();
    }

    #[test]
    fn the_newest_files_come_first_and_noise_is_skipped() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "old.zip", 300);
        touch(dir.path(), "new.pdf", 10);
        touch(dir.path(), "desktop.ini", 5);
        touch(dir.path(), "movie.mp4.crdownload", 20);
        let state = scan(Kind::Downloads, dir.path());
        let names: Vec<_> = state.items.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(names, ["new.pdf", "movie.mp4.crdownload", "old.zip"]);
        assert!(state.items[1].partial);
        assert!(!state.items[0].partial);
    }

    #[test]
    fn screenshots_are_images_only() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "shot.PNG", 1);
        touch(dir.path(), "notes.txt", 1);
        fs::create_dir(dir.path().join("sub")).unwrap();
        let names: Vec<_> = scan(Kind::Screenshots, dir.path()).items.into_iter().map(|i| i.name).collect();
        assert_eq!(names, ["shot.PNG"]);
    }

    #[test]
    fn the_list_is_capped() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..DOWNLOADS_LIMIT + 5 {
            touch(dir.path(), &format!("f{i}.bin"), i as u64);
        }
        assert_eq!(scan(Kind::Downloads, dir.path()).items.len(), DOWNLOADS_LIMIT);
    }

    #[test]
    fn a_missing_folder_is_empty_not_an_error() {
        let state = scan(Kind::Screenshots, Path::new(r"C:\no\such\folder"));
        assert!(state.items.is_empty() && state.problem.is_none());
    }

    #[test]
    fn a_change_in_the_folder_reaches_the_subscriber() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let p = FolderProvider::new(
            Kind::Downloads,
            Some(dir.path().to_path_buf()),
            Emitter::new(move |d| {
                let _ = tx.send(d);
            }),
        );
        p.start().unwrap();
        let _ = rx.recv_timeout(Duration::from_secs(2)); // the initial (empty) state
        touch(dir.path(), "fresh.txt", 0);
        let mut seen = false;
        for _ in 0..20 {
            if let Ok(TileData::Downloads(s)) = rx.recv_timeout(Duration::from_millis(500)) {
                if s.items.iter().any(|i| i.name == "fresh.txt") {
                    seen = true;
                    break;
                }
            }
        }
        p.stop();
        assert!(seen, "the new file was not reported");
    }
}

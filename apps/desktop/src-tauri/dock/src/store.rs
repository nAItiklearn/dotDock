//! What the dock remembers between runs, and how it is written to disk.
//!
//! Two files under the app's data folder: `dock.json` (settings, categories, the user's own filing, when each
//! app was first seen) and `catalogue-cache.json` (the app list of the last scan, so a start does not wait for
//! the shell). Both are written atomically (a temporary file renamed over the old one, so a reader or a crash
//! sees the old file or the new one, never half of one) and at most once per second however often the data
//! changes (`DebouncedFile`), because a settings slider can change a value a hundred times a second.

use crate::catalogue::AppEntry;
use crate::protocol::{Category, CategoryId, DockSettings};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub const STORE_FILE: &str = "dock.json";
pub const CACHE_FILE: &str = "catalogue-cache.json";
/// A file that cannot be read is renamed to this suffix instead of being overwritten, so nothing is lost.
const CORRUPT_SUFFIX: &str = "bad";
/// Shortest time between two writes of one file.
pub const WRITE_INTERVAL: Duration = Duration::from_secs(1);
const STORE_SCHEMA: u32 = 1;
const CACHE_SCHEMA: u32 = 1;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreData {
    pub schema: u32,
    pub settings: DockSettings,
    pub categories: Vec<Category>,
    /// The user's own filing: app id to category. Wins over everything the classifier would say.
    pub assignments: BTreeMap<String, CategoryId>,
    /// Epoch ms each app was first seen; 0 for apps that were already installed at the first scan.
    pub first_seen: BTreeMap<String, u64>,
    /// True once the first scan has run, so later new apps get a real `first_seen`.
    pub scanned_once: bool,
    /// True once the first layout was placed on an empty dock (`starter`), so it is never placed again.
    #[serde(default)]
    pub laid_out: bool,
}

impl Default for StoreData {
    fn default() -> Self {
        StoreData {
            schema: STORE_SCHEMA,
            settings: DockSettings::default(),
            categories: Category::defaults(),
            assignments: BTreeMap::new(),
            first_seen: BTreeMap::new(),
            scanned_once: false,
            laid_out: false,
        }
    }
}

impl StoreData {
    /// Reads the store. A missing file gives the defaults; a file that does not parse is kept as `dock.json.bad`
    /// and the defaults are used.
    pub fn load(path: &Path) -> StoreData {
        let Ok(text) = std::fs::read_to_string(path) else { return StoreData::default() };
        match serde_json::from_str::<StoreData>(&text) {
            Ok(data) if data.schema == STORE_SCHEMA => data.repaired(),
            _ => {
                let _ = std::fs::rename(path, path.with_extension(format!("json.{CORRUPT_SUFFIX}")));
                StoreData::default()
            }
        }
    }

    /// Drops filings that name a category that no longer exists, and refills an empty category list.
    fn repaired(mut self) -> StoreData {
        if self.categories.is_empty() {
            self.categories = Category::defaults();
        }
        let known: Vec<CategoryId> = self.categories.iter().map(|c| c.id.clone()).collect();
        self.assignments.retain(|_, c| known.contains(c));
        self
    }

    pub fn has_category(&self, id: &CategoryId) -> bool {
        self.categories.iter().any(|c| &c.id == id)
    }
}

/// The scan of the last run, valid for as long as the fingerprint of the Start menu and the package list matches.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CatalogueCache {
    pub schema: u32,
    pub fingerprint: String,
    pub apps: Vec<AppEntry>,
}

impl CatalogueCache {
    pub fn new(fingerprint: String, apps: Vec<AppEntry>) -> CatalogueCache {
        CatalogueCache { schema: CACHE_SCHEMA, fingerprint, apps }
    }

    pub fn load(path: &Path) -> Option<CatalogueCache> {
        let cache: CatalogueCache = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
        (cache.schema == CACHE_SCHEMA).then_some(cache)
    }
}

/// Writes `bytes` to `path` so that the file is always either the old content or the new.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

struct Pending {
    bytes: Option<Vec<u8>>,
    stop: bool,
    /// A caller is waiting for everything queued so far to reach the disk, interval or not.
    flush: bool,
    writes: u64,
}

struct Slot {
    pending: Mutex<Pending>,
    wake: Condvar,
}

fn lock(m: &Mutex<Pending>) -> MutexGuard<'_, Pending> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// A file written in the background: `save` stores the newest bytes and returns at once; a thread writes them
/// when at least `WRITE_INTERVAL` has passed since the last write. Only the newest bytes are ever written, so a
/// burst of changes is one write. The thread sleeps on a condition variable; with nothing to write it does not
/// wake. Dropping the value writes what is pending right away.
pub struct DebouncedFile {
    slot: Arc<Slot>,
    thread: Option<JoinHandle<()>>,
}

impl DebouncedFile {
    pub fn new(path: PathBuf) -> io::Result<DebouncedFile> {
        Self::with_interval(path, WRITE_INTERVAL)
    }

    pub fn with_interval(path: PathBuf, interval: Duration) -> io::Result<DebouncedFile> {
        let slot = Arc::new(Slot {
            pending: Mutex::new(Pending { bytes: None, stop: false, flush: false, writes: 0 }),
            wake: Condvar::new(),
        });
        let worker = Arc::clone(&slot);
        let thread =
            std::thread::Builder::new().name("dock-store".into()).spawn(move || run(&worker, &path, interval))?;
        Ok(DebouncedFile { slot, thread: Some(thread) })
    }

    /// Queues `bytes` as the new content of the file.
    pub fn save(&self, bytes: Vec<u8>) {
        lock(&self.slot.pending).bytes = Some(bytes);
        self.slot.wake.notify_all();
    }

    /// Serialises `value` and queues it. A value that cannot be serialised is dropped (it is plain data, so this
    /// does not happen for the dock's own types).
    pub fn save_json<T: Serialize>(&self, value: &T) {
        if let Ok(bytes) = serde_json::to_vec_pretty(value) {
            self.save(bytes);
        }
    }

    /// Blocks until everything queued so far is on disk, ignoring the interval. For shutdown: the file is
    /// current when this returns, and the thread keeps running for later saves.
    pub fn flush(&self) {
        let mut state = lock(&self.slot.pending);
        state.flush = true;
        self.slot.wake.notify_all();
        while state.flush && !state.stop {
            state = self.slot.wake.wait(state).unwrap_or_else(|p| p.into_inner());
        }
    }

    /// Number of writes done so far.
    pub fn writes(&self) -> u64 {
        lock(&self.slot.pending).writes
    }
}

fn run(slot: &Slot, path: &Path, interval: Duration) {
    let mut last_write: Option<Instant> = None;
    let mut state = lock(&slot.pending);
    loop {
        // Sleep until there is something to write, or a caller wants the disk caught up, or it is time to stop.
        while state.bytes.is_none() && !state.stop && !state.flush {
            state = slot.wake.wait(state).unwrap_or_else(|p| p.into_inner());
        }
        // Hold back until the interval since the last write has passed, unless stopping or flushing.
        while !state.stop && !state.flush {
            let wait = last_write.map_or(Duration::ZERO, |t| interval.saturating_sub(t.elapsed()));
            if wait.is_zero() {
                break;
            }
            state = slot.wake.wait_timeout(state, wait).unwrap_or_else(|p| p.into_inner()).0;
        }
        if let Some(bytes) = state.bytes.take() {
            drop(state);
            let _ = write_atomic(path, &bytes);
            last_write = Some(Instant::now());
            state = lock(&slot.pending);
            state.writes += 1;
        }
        if state.flush {
            state.flush = false;
            slot.wake.notify_all();
        }
        if state.stop && state.bytes.is_none() {
            return;
        }
    }
}

impl Drop for DebouncedFile {
    fn drop(&mut self) {
        lock(&self.slot.pending).stop = true;
        self.slot.wake.notify_all();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::Builtin;

    #[test]
    fn missing_file_gives_the_defaults() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(StoreData::load(&dir.path().join(STORE_FILE)), StoreData::default());
    }

    #[test]
    fn a_store_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(STORE_FILE);
        let mut data = StoreData::default();
        data.assignments.insert("chrome".into(), Builtin::Development.into());
        data.first_seen.insert("chrome".into(), 42);
        data.scanned_once = true;
        write_atomic(&path, &serde_json::to_vec(&data).unwrap()).unwrap();
        assert_eq!(StoreData::load(&path), data);
    }

    #[test]
    fn a_corrupt_store_is_kept_aside_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(STORE_FILE);
        std::fs::write(&path, b"{ not json").unwrap();
        assert_eq!(StoreData::load(&path), StoreData::default());
        assert!(!path.exists());
        assert_eq!(std::fs::read(dir.path().join("dock.json.bad")).unwrap(), b"{ not json");
    }

    #[test]
    fn a_newer_schema_is_kept_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(STORE_FILE);
        let mut value = serde_json::to_value(StoreData::default()).unwrap();
        value["schema"] = serde_json::json!(99);
        std::fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(StoreData::load(&path), StoreData::default());
        assert!(dir.path().join("dock.json.bad").exists());
    }

    #[test]
    fn filings_into_deleted_categories_are_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(STORE_FILE);
        let mut data = StoreData::default();
        let gone = CategoryId::parse("custom:gone").unwrap();
        data.assignments.insert("a".into(), gone);
        data.assignments.insert("b".into(), Builtin::Games.into());
        write_atomic(&path, &serde_json::to_vec(&data).unwrap()).unwrap();
        let loaded = StoreData::load(&path);
        assert!(!loaded.assignments.contains_key("a"));
        assert!(loaded.assignments.contains_key("b"));
    }

    #[test]
    fn an_empty_category_list_is_refilled() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(STORE_FILE);
        let data = StoreData { categories: vec![], ..StoreData::default() };
        write_atomic(&path, &serde_json::to_vec(&data).unwrap()).unwrap();
        assert_eq!(StoreData::load(&path).categories, Category::defaults());
    }

    #[test]
    fn atomic_write_leaves_no_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.json");
        write_atomic(&path, b"1").unwrap();
        write_atomic(&path, b"2").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"2");
        let names: Vec<_> = std::fs::read_dir(dir.path()).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(names, ["x.json"]);
    }

    #[test]
    fn a_burst_of_saves_is_one_write_of_the_newest_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("burst.json");
        let file = DebouncedFile::with_interval(path.clone(), Duration::from_millis(150)).unwrap();
        for i in 0..50 {
            file.save(format!("{i}").into_bytes());
        }
        std::thread::sleep(Duration::from_millis(500));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "49");
        assert!(file.writes() <= 2, "{} writes", file.writes());
    }

    #[test]
    fn writes_are_spaced_by_the_interval() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("spaced.json");
        let interval = Duration::from_millis(200);
        let file = DebouncedFile::with_interval(path, interval).unwrap();
        let started = Instant::now();
        file.save(b"a".to_vec());
        std::thread::sleep(Duration::from_millis(60));
        file.save(b"b".to_vec());
        while file.writes() < 2 && started.elapsed() < Duration::from_secs(3) {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(file.writes(), 2);
        assert!(started.elapsed() >= interval, "second write came after {:?}", started.elapsed());
    }

    #[test]
    fn flushing_writes_now_and_keeps_the_file_usable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("flush-now.json");
        let file = DebouncedFile::with_interval(path.clone(), Duration::from_secs(60)).unwrap();
        file.save(b"one".to_vec());
        file.flush();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "one");
        // Flushing with nothing queued returns at once.
        file.flush();
        file.save(b"two".to_vec());
        file.flush();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "two");
    }

    #[test]
    fn dropping_writes_what_is_pending_at_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("flush.json");
        {
            let file = DebouncedFile::with_interval(path.clone(), Duration::from_secs(60)).unwrap();
            file.save(b"first".to_vec());
            std::thread::sleep(Duration::from_millis(50));
            file.save(b"last".to_vec());
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "last");
    }

    #[test]
    fn the_catalogue_cache_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(CACHE_FILE);
        let app =
            AppEntry { id: "x".into(), name: "X".into(), target: Some("C:\\x.exe".into()), ..AppEntry::default() };
        let cache = CatalogueCache::new("fp".into(), vec![app.clone()]);
        write_atomic(&path, &serde_json::to_vec(&cache).unwrap()).unwrap();
        let loaded = CatalogueCache::load(&path).unwrap();
        assert_eq!(loaded.fingerprint, "fp");
        assert_eq!(loaded.apps, vec![app]);
        std::fs::write(&path, b"garbage").unwrap();
        assert!(CatalogueCache::load(&path).is_none());
    }
}

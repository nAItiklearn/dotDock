//! The thread icons are extracted on. Requests queue up; a request for an icon that is already on disk costs
//! one `stat`; the thread sleeps on a channel while there is nothing to do.

use super::image::encode_png;
use super::{cache_path, is_cached, shell, write_atomic, IconKey, IconSource};
use crate::com::ComGuard;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
pub struct IconRequest {
    pub key: IconKey,
    /// Where to read the picture from, best first.
    pub sources: Vec<IconSource>,
}

#[derive(Default)]
struct State {
    /// Queued or being extracted.
    pending: HashSet<String>,
    /// Extraction was tried and produced nothing; not retried this session.
    failed: HashSet<String>,
    /// Extractions that ran (not served from the cache), for the measurements in the spike report.
    extracted: u64,
    /// Time spent asking the shell for pictures, and encoding and writing them, summed over all extractions.
    shell_time: Duration,
    encode_time: Duration,
}

struct Shared {
    dir: PathBuf,
    state: Mutex<State>,
    changed: Condvar,
}

fn lock(m: &Mutex<State>) -> MutexGuard<'_, State> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// Most threads extracting at once. The shell spends its time decoding and scaling, which runs side by side
/// on separate threads; past a few the disk and the shell's own locks are the limit.
const MAX_THREADS: usize = 4;

pub struct IconWorker {
    shared: Arc<Shared>,
    tx: Option<Sender<IconRequest>>,
    threads: Vec<JoinHandle<()>>,
}

impl IconWorker {
    /// Starts the threads; icons are written under `dir`, which is created if needed. The threads take
    /// requests from one queue and sleep in `recv` while it is empty.
    pub fn start(dir: PathBuf) -> std::io::Result<IconWorker> {
        std::fs::create_dir_all(&dir)?;
        let shared = Arc::new(Shared { dir, state: Mutex::new(State::default()), changed: Condvar::new() });
        let (tx, rx) = channel::<IconRequest>();
        let rx = Arc::new(Mutex::new(rx));
        let count = std::thread::available_parallelism().map_or(1, |n| n.get()).clamp(1, MAX_THREADS);
        let threads = (0..count)
            .map(|n| {
                let (shared, rx) = (Arc::clone(&shared), Arc::clone(&rx));
                std::thread::Builder::new().name(format!("dock-icons-{n}")).spawn(move || {
                    let _com = ComGuard::new();
                    loop {
                        // One thread waits in `recv` holding the lock; the others wait for the lock.
                        let next = rx.lock().unwrap_or_else(|p| p.into_inner()).recv();
                        let Ok(request) = next else { break };
                        process(&shared, &request);
                    }
                })
            })
            .collect::<std::io::Result<Vec<_>>>()?;
        Ok(IconWorker { shared, tx: Some(tx), threads })
    }

    pub fn dir(&self) -> &Path {
        &self.shared.dir
    }

    /// Queues `request` unless its icon is already on disk or already queued.
    pub fn request(&self, request: IconRequest) {
        if is_cached(&self.shared.dir, &request.key) {
            return;
        }
        {
            let mut state = lock(&self.shared.state);
            if state.failed.contains(request.key.hash()) || !state.pending.insert(request.key.hash().to_owned()) {
                return;
            }
        }
        if let Some(tx) = &self.tx {
            let _ = tx.send(request);
        }
    }

    /// The cached file for `key`, if it exists right now.
    pub fn path(&self, key: &IconKey) -> Option<PathBuf> {
        let path = cache_path(&self.shared.dir, key);
        path.is_file().then_some(path)
    }

    /// Waits up to `timeout` for the icon to exist, for the host's `dock-icon://` handler: a request that
    /// arrives before extraction finishes is answered late instead of with a broken image.
    pub fn wait_for(&self, key: &IconKey, timeout: Duration) -> Option<PathBuf> {
        let deadline = Instant::now() + timeout;
        let mut state = lock(&self.shared.state);
        loop {
            if let Some(path) = self.path(key) {
                return Some(path);
            }
            if state.failed.contains(key.hash()) || !state.pending.contains(key.hash()) {
                return None;
            }
            let left = deadline.checked_duration_since(Instant::now())?;
            state = self.shared.changed.wait_timeout(state, left).unwrap_or_else(|p| p.into_inner()).0;
        }
    }

    /// Number of icons extracted from the shell (not counting cache hits) since start.
    pub fn extracted(&self) -> u64 {
        lock(&self.shared.state).extracted
    }

    /// Total time spent in the shell and in PNG encoding plus writing, over every extraction since start, summed
    /// over all threads.
    pub fn time_spent(&self) -> (Duration, Duration) {
        let state = lock(&self.shared.state);
        (state.shell_time, state.encode_time)
    }

    /// Icons queued or in progress.
    pub fn pending(&self) -> usize {
        lock(&self.shared.state).pending.len()
    }
}

fn process(shared: &Shared, request: &IconRequest) {
    let hash = request.key.hash().to_owned();
    let mut spent = (Duration::ZERO, Duration::ZERO);
    let result = if is_cached(&shared.dir, &request.key) {
        Ok(false)
    } else {
        let started = Instant::now();
        let image = shell::extract_first(&request.sources);
        spent.0 = started.elapsed();
        let started = Instant::now();
        let written = image
            .and_then(|image| encode_png(&image))
            .and_then(|png| write_atomic(&cache_path(&shared.dir, &request.key), &png))
            .map(|()| true);
        spent.1 = started.elapsed();
        written
    };
    let mut state = lock(&shared.state);
    state.pending.remove(&hash);
    state.shell_time += spent.0;
    state.encode_time += spent.1;
    match result {
        Ok(true) => state.extracted += 1,
        Ok(false) => {}
        Err(_) => {
            state.failed.insert(hash);
        }
    }
    shared.changed.notify_all();
}

impl Drop for IconWorker {
    fn drop(&mut self) {
        // Closing the channel ends each thread's loop after the request it is on.
        self.tx = None;
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

//! Knowing when the catalogue is stale, without a timer.
//!
//! The Start menu folders are watched with `ReadDirectoryChangesW` (through the `notify` crate), and the
//! per-user package list in the registry with `RegNotifyChangeKeyValue`; both block until something changes.
//! Changes arrive in bursts (an installer writes a dozen shortcuts), so they are coalesced: the rescan
//! callback runs once, after `QUIET` with no further change. The fingerprint lets a start decide, from a
//! cheap look at the same two places, whether the cached catalogue is still right.

use crate::catalogue::start_menu_roots;
use crate::com::wide;
use crate::util::stable_hash;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::io;
use std::path::Path;
use std::sync::mpsc::{channel, Sender};
use std::thread::JoinHandle;
use std::time::{Duration, UNIX_EPOCH};
use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, WAIT_OBJECT_0};
use windows::Win32::System::Registry::{
    RegCloseKey, RegNotifyChangeKeyValue, RegOpenKeyExW, RegQueryInfoKeyW, HKEY, HKEY_CURRENT_USER, KEY_NOTIFY,
    KEY_READ, REG_NOTIFY_CHANGE_LAST_SET, REG_NOTIFY_CHANGE_NAME,
};
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForMultipleObjects, INFINITE};

/// No change for this long means an installer is done.
pub const QUIET: Duration = Duration::from_millis(1500);

/// The per-user list of registered packages; it gains and loses a key whenever a Store app is installed or
/// removed.
const PACKAGES_KEY: &str =
    "Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages";

fn shortcut_files(root: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            shortcut_files(&path, out);
        } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk") || e.eq_ignore_ascii_case("url")) {
            let modified =
                meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
            out.push(format!("{}|{}|{modified}", path.display().to_string().to_lowercase(), meta.len()));
        }
    }
}

/// Number of subkeys and last write time of the package list, or zeros when the key is missing.
fn packages_stamp() -> (u32, u64) {
    let key = wide(PACKAGES_KEY);
    let mut handle = HKEY::default();
    // SAFETY: opens a read-only key, queries it into locals and closes it.
    unsafe {
        if RegOpenKeyExW(HKEY_CURRENT_USER, crate::com::pcwstr(&key), None, KEY_READ, &mut handle).is_err() {
            return (0, 0);
        }
        let mut subkeys = 0u32;
        let mut written = FILETIME::default();
        let _ = RegQueryInfoKeyW(
            handle,
            None,
            None,
            None,
            Some(&mut subkeys),
            None,
            None,
            None,
            None,
            None,
            None,
            Some(&mut written),
        );
        let _ = RegCloseKey(handle);
        (subkeys, (u64::from(written.dwHighDateTime) << 32) | u64::from(written.dwLowDateTime))
    }
}

/// A short string that changes when a shortcut is added, removed or rewritten, or a package is installed or
/// removed. Cheap: one directory walk and one registry query, no COM.
pub fn fingerprint() -> String {
    let mut files = Vec::new();
    for root in start_menu_roots() {
        shortcut_files(&root, &mut files);
    }
    files.sort();
    let (subkeys, written) = packages_stamp();
    let joined = files.join("\n");
    format!("{:016x}", stable_hash(&[&joined, &subkeys.to_string(), &written.to_string()]))
}

/// Calls `on_change` once after a burst of changes to the Start menu or the package list.
pub struct CatalogueWatcher {
    _files: Option<RecommendedWatcher>,
    changes: Option<Sender<()>>,
    debounce: Option<JoinHandle<()>>,
    registry: Option<(JoinHandle<()>, StopEvent)>,
}

/// A manual-reset event the registry thread waits on besides the change event.
struct StopEvent(HANDLE);

// SAFETY: an event handle can be signalled and closed from any thread, and `StopEvent` is only ever used to do
// exactly that.
unsafe impl Send for StopEvent {}
unsafe impl Sync for StopEvent {}

impl CatalogueWatcher {
    pub fn start(on_change: impl Fn() + Send + 'static) -> io::Result<CatalogueWatcher> {
        let (tx, rx) = channel::<()>();
        let debounce = std::thread::Builder::new().name("dock-catalogue-watch".into()).spawn(move || {
            // Sleep until the first change, then until a QUIET gap with no change.
            while rx.recv().is_ok() {
                while rx.recv_timeout(QUIET).is_ok() {}
                on_change();
            }
        })?;

        let file_tx = tx.clone();
        let mut files = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if event.is_ok() {
                let _ = file_tx.send(());
            }
        })
        .map_err(io::Error::other)?;
        for root in start_menu_roots() {
            let _ = files.watch(&root, RecursiveMode::Recursive);
        }

        let registry = spawn_registry_watch(tx.clone())?;
        Ok(CatalogueWatcher { _files: Some(files), changes: Some(tx), debounce: Some(debounce), registry })
    }
}

fn spawn_registry_watch(changes: Sender<()>) -> io::Result<Option<(JoinHandle<()>, StopEvent)>> {
    let key = wide(PACKAGES_KEY);
    let mut handle = HKEY::default();
    // SAFETY: opens a key for change notification; closed by the thread below.
    let opened = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, crate::com::pcwstr(&key), None, KEY_NOTIFY, &mut handle) };
    if opened.is_err() {
        return Ok(None);
    }
    // SAFETY: plain event creation; closed by `Drop` once the thread has ended.
    let stop = unsafe { CreateEventW(None, true, false, windows::core::PCWSTR::null()) }.map_err(io::Error::other)?;
    let thread_stop = StopEvent(stop);
    let thread_key = RegKey(handle);
    let thread = std::thread::Builder::new().name("dock-package-watch".into()).spawn(move || {
        let (stop, key) = (thread_stop, thread_key);
        // SAFETY: the change event, the one-shot notification armed on our key, and the wait on it and the stop
        // event are all owned by this thread; everything is closed before it returns.
        unsafe {
            if let Ok(changed) = CreateEventW(None, false, false, windows::core::PCWSTR::null()) {
                while RegNotifyChangeKeyValue(
                    key.0,
                    true,
                    REG_NOTIFY_CHANGE_NAME | REG_NOTIFY_CHANGE_LAST_SET,
                    Some(changed),
                    true,
                )
                .is_ok()
                    && WaitForMultipleObjects(&[changed, stop.0], false, INFINITE) == WAIT_OBJECT_0
                    && changes.send(()).is_ok()
                {}
                let _ = CloseHandle(changed);
            }
            let _ = RegCloseKey(key.0);
        }
    })?;
    Ok(Some((thread, StopEvent(stop))))
}

struct RegKey(HKEY);

// SAFETY: a registry key handle can be used and closed from any thread.
unsafe impl Send for RegKey {}

impl Drop for CatalogueWatcher {
    fn drop(&mut self) {
        // Closing the sender ends the debounce thread; signalling the stop event ends the registry thread.
        self._files = None;
        self.changes = None;
        if let Some((thread, stop)) = self.registry.take() {
            // SAFETY: wakes the registry thread, which then exits; the stop event is closed afterwards.
            unsafe {
                let _ = SetEvent(stop.0);
            }
            let _ = thread.join();
            // SAFETY: the thread is gone, so nothing waits on the event any more.
            unsafe {
                let _ = CloseHandle(stop.0);
            }
        }
        if let Some(thread) = self.debounce.take() {
            let _ = thread.join();
        }
    }
}

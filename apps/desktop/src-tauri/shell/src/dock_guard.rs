//! The only path that hides the Windows taskbar, and the paths that put it back.
//!
//! Before anything is hidden, a marker file records who hid it and what "Automatically hide the
//! taskbar" was. The marker is the single record of "the taskbar is hidden by us":
//! - the core removes it after a clean restore (`restore_after_dock`, also from the panic hook);
//! - the sentinel acts on it when the core ends in any other way, `taskkill /F` included;
//! - the next start acts on it when even the sentinel could not (`recover_if_dirty`).
//!
//! Restoring is always the safe direction: when the marker is unreadable, the taskbar is shown.

use crate::process::Process;
use crate::{app_data_dir, boot_log, sentinel, snapshot, taskbar};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::Path;
use std::time::{Duration, Instant};

const MARKER_FILE: &str = "taskbar-hidden.json";
const SCHEMA: u32 = 1;
/// Explorer applies an auto-hide change a moment after it is requested, and re-shows a hidden
/// taskbar window while doing so (measured: about 50 ms later). One round waits this long.
const SETTLE: Duration = Duration::from_secs(1);
const SETTLE_STEP: Duration = Duration::from_millis(20);
/// A hide is only trusted once the taskbar has stayed hidden this long.
const HIDE_SETTLE: Duration = Duration::from_millis(150);
const HIDE_ROUNDS: u32 = 10;
/// How long the sentinel and the next start keep trying when Explorer is not there yet.
const RESTORE_PATIENCE: Duration = Duration::from_secs(10);
/// How long an exiting or panicking process waits for its own restore.
const EXIT_RESTORE_LIMIT: Duration = Duration::from_secs(3);

#[derive(Debug, thiserror::Error)]
pub enum GuardError {
    #[error("no writable app data folder, so the way back cannot be recorded")]
    NoAppData,
    #[error("this process cannot be identified, so the way back cannot be recorded")]
    NoIdentity,
    #[error("Explorer has no taskbar right now, so there is nothing to hide")]
    NoTaskbar,
    #[error("another dotDock process is already hiding the taskbar")]
    HeldByAnotherInstance,
    #[error("an earlier run left the taskbar hidden and it could not be shown again")]
    StaleMarker,
    #[error("Explorer keeps showing the taskbar again, so it was put back as it was")]
    WillNotStayHidden,
    #[error("the original taskbar settings are not in the Windows snapshot; run tools/snapshot-windows.ps1")]
    SnapshotLacksTaskbar,
    #[error(transparent)]
    Snapshot(#[from] snapshot::SnapshotError),
    #[error(transparent)]
    Sentinel(#[from] sentinel::SentinelError),
    #[error("taskbar marker: {0}")]
    Marker(#[from] std::io::Error),
}

/// The process that hid the taskbar. The start time keeps a reused pid from looking like it.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Owner {
    pid: u32,
    started: u64,
}

impl Owner {
    fn current() -> Option<Self> {
        let pid = std::process::id();
        Some(Self { pid, started: Process::open(pid)?.started()? })
    }

    fn is_running(&self) -> bool {
        Process::open(self.pid).is_some_and(|p| p.started() == Some(self.started) && p.is_running())
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Marker {
    schema: u32,
    owner: Owner,
    /// "Automatically hide the taskbar" as it was just before the first hide of this run.
    auto_hide_before: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum Load {
    Absent,
    Present(Marker),
    /// The file exists but cannot be used. Treated as hidden: showing the taskbar is always safe.
    Unreadable,
}

fn load_from(dir: &Path) -> Load {
    match std::fs::read(dir.join(MARKER_FILE)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_or(Load::Unreadable, Load::Present),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Load::Absent,
        Err(_) => Load::Unreadable,
    }
}

/// Write-then-rename, flushed to disk, so a power cut leaves the old marker or the new one, never half.
fn store_to(dir: &Path, marker: &Marker) -> std::io::Result<()> {
    let tmp = dir.join(format!("{MARKER_FILE}.tmp"));
    let mut file = std::fs::File::create(&tmp)?;
    file.write_all(&serde_json::to_vec_pretty(marker)?)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(tmp, dir.join(MARKER_FILE))
}

fn clear_in(dir: &Path) {
    // Nothing to do when it is already gone; any other failure shows up as a marker the next start handles.
    let _ = std::fs::remove_file(dir.join(MARKER_FILE));
}

#[derive(Debug, PartialEq, Eq)]
enum Verdict {
    Leave,
    PutBack,
}

/// A new process finds a marker: it is stale unless the process that wrote it is still running.
fn startup_verdict(load: &Load, owner_running: impl Fn(&Owner) -> bool) -> Verdict {
    match load {
        Load::Absent => Verdict::Leave,
        Load::Unreadable => Verdict::PutBack,
        Load::Present(marker) if owner_running(&marker.owner) => Verdict::Leave,
        Load::Present(_) => Verdict::PutBack,
    }
}

/// The sentinel's watched process ended. Only its own marker is acted on: a later run may hold a new one.
fn exit_verdict(load: &Load, watched_pid: u32) -> Verdict {
    match load {
        Load::Absent => Verdict::Leave,
        Load::Unreadable => Verdict::PutBack,
        Load::Present(marker) if marker.owner.pid == watched_pid => Verdict::PutBack,
        Load::Present(_) => Verdict::Leave,
    }
}

/// A process restoring by itself acts on its own marker only; another instance's dock stays up.
fn own_verdict(load: &Load, me: Option<Owner>) -> Verdict {
    match load {
        Load::Absent => Verdict::Leave,
        Load::Unreadable => Verdict::PutBack,
        Load::Present(marker) if Some(marker.owner) == me => Verdict::PutBack,
        Load::Present(_) => Verdict::Leave,
    }
}

fn snapshot_auto_hide() -> Option<bool> {
    snapshot::load().ok().flatten().and_then(|s| s.taskbar_auto_hide)
}

fn is_back(auto_hide: Option<bool>) -> bool {
    taskbar::is_visible() == Some(true) && auto_hide.is_none_or(|on| taskbar::auto_hide() == on)
}

/// One round: asks for auto-hide back and shows the taskbar, then gives Explorer `SETTLE` to
/// apply it. True once both are verified.
fn put_back(auto_hide: Option<bool>) -> bool {
    if let Some(on) = auto_hide {
        taskbar::set_auto_hide(on);
    }
    let deadline = Instant::now() + SETTLE;
    loop {
        taskbar::show_all();
        if is_back(auto_hide) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(SETTLE_STEP);
    }
}

/// Puts the taskbar back, then drops the marker. Rounds repeat for `patience` (Explorer may be
/// restarting). The marker stays unless the result was verified, so the next process to look
/// still knows there is work to do.
fn restore_and_clear(dir: &Path, load: &Load, patience: Duration) -> bool {
    let auto_hide = match load {
        Load::Present(marker) => Some(marker.auto_hide_before),
        Load::Absent | Load::Unreadable => snapshot_auto_hide(),
    };
    let deadline = Instant::now() + patience;
    loop {
        if put_back(auto_hide) {
            clear_in(dir);
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
    }
}

/// Hides every taskbar and keeps hiding until it stays hidden: turning auto-hide on makes
/// Explorer re-show the window a moment later. False if it never stays hidden.
fn hide_until_stable() -> bool {
    taskbar::set_auto_hide(true);
    for _ in 0..HIDE_ROUNDS {
        taskbar::hide_all();
        std::thread::sleep(HIDE_SETTLE);
        if taskbar::is_hidden() == Some(true) {
            return true;
        }
    }
    false
}

fn require_taskbar_snapshot() -> Result<(), GuardError> {
    snapshot::ensure(false)?;
    match snapshot::load()? {
        Some(snap) if snap.taskbar_auto_hide.is_some() => Ok(()),
        _ => Err(GuardError::SnapshotLacksTaskbar),
    }
}

/// Hides the taskbar for the dock. Order matters: the original state is on record, the sentinel is
/// watching, and the marker is on disk before the first window is hidden. Safe to call again after
/// Explorer restarts; the original auto-hide value of this run is kept.
pub fn hide_for_dock() -> Result<(), GuardError> {
    let dir = app_data_dir().ok_or(GuardError::NoAppData)?;
    let me = Owner::current().ok_or(GuardError::NoIdentity)?;
    // Without a taskbar window the auto-hide state cannot be read, so "before" would be a guess.
    if taskbar::is_visible().is_none() {
        return Err(GuardError::NoTaskbar);
    }
    let found = load_from(&dir);
    let auto_hide_before = match found {
        Load::Present(marker) if marker.owner == me => marker.auto_hide_before,
        Load::Absent => taskbar::auto_hide(),
        stale => {
            if startup_verdict(&stale, Owner::is_running) == Verdict::Leave {
                return Err(GuardError::HeldByAnotherInstance);
            }
            if !restore_and_clear(&dir, &stale, SETTLE) {
                return Err(GuardError::StaleMarker);
            }
            taskbar::auto_hide()
        }
    };
    require_taskbar_snapshot()?;
    sentinel::start()?;
    let marker = Marker { schema: SCHEMA, owner: me, auto_hide_before };
    store_to(&dir, &marker)?;
    // Auto-hide on frees the work area the hidden taskbar would still reserve.
    if !hide_until_stable() {
        restore_and_clear(&dir, &Load::Present(marker), SETTLE);
        return Err(GuardError::WillNotStayHidden);
    }
    boot_log::record(&format!("dock-guard: taskbar hidden, auto-hide before={auto_hide_before}"));
    Ok(())
}

fn restore_own_marker() {
    let Some(dir) = app_data_dir() else { return };
    let load = load_from(&dir);
    if own_verdict(&load, Owner::current()) == Verdict::PutBack {
        let restored = restore_and_clear(&dir, &load, SETTLE);
        boot_log::record(&format!("dock-guard: restore after dock, verified={restored}"));
    }
}

/// Shows the taskbar and sets auto-hide back, if this process hid it. Never panics: it also runs
/// from the panic hook. Called on every clean exit path. It gives up after `EXIT_RESTORE_LIMIT`
/// (a hung Explorer must not hang an exiting process); the sentinel finishes the job then.
pub fn restore_after_dock() {
    let (done, finished) = std::sync::mpsc::channel();
    let worker = std::thread::Builder::new().name("dock-restore".to_owned()).spawn(move || {
        restore_own_marker();
        let _ = done.send(());
    });
    match worker {
        Ok(_) => {
            let _ = finished.recv_timeout(EXIT_RESTORE_LIMIT);
        }
        // No thread to spare: restore inline, without the time limit.
        Err(_) => restore_own_marker(),
    }
}

/// What `recover_if_dirty` found.
#[derive(Debug, PartialEq, Eq)]
pub enum Recovery {
    /// No marker: the last run did not leave the taskbar hidden.
    Clean,
    /// An earlier run left the taskbar hidden; it is shown again and auto-hide is back.
    Restored,
    /// The marker belongs to a dotDock process that is still running, so it was left alone.
    OwnerRunning,
    /// The taskbar could not be shown (Explorer is not running). The marker stays for the next start.
    Failed,
}

/// First thing at start-up: an earlier run that ended without restoring (power loss, a killed
/// sentinel as well as a killed core) is undone before anything else happens.
pub fn recover_if_dirty() -> Recovery {
    let Some(dir) = app_data_dir() else { return Recovery::Clean };
    let load = load_from(&dir);
    let outcome = match startup_verdict(&load, Owner::is_running) {
        Verdict::Leave if load == Load::Absent => Recovery::Clean,
        Verdict::Leave => Recovery::OwnerRunning,
        Verdict::PutBack if restore_and_clear(&dir, &load, RESTORE_PATIENCE) => Recovery::Restored,
        Verdict::PutBack => Recovery::Failed,
    };
    if outcome != Recovery::Clean {
        boot_log::record(&format!("dock-guard: recover at start {outcome:?}"));
    }
    outcome
}

/// The sentinel's watched process has ended: restore if it left the taskbar hidden.
pub(crate) fn after_owner_ended(pid: u32) {
    let Some(dir) = app_data_dir() else { return };
    let load = load_from(&dir);
    if exit_verdict(&load, pid) == Verdict::PutBack {
        let restored = restore_and_clear(&dir, &load, RESTORE_PATIENCE);
        boot_log::record(&format!("dock-guard: sentinel restore after pid {pid} ended, verified={restored}"));
    }
}

/// Shows the taskbar and drops the marker, whoever hid it. For the panic button and the uninstaller,
/// which run in a process of their own and must not leave the taskbar hidden for any reason.
pub fn release() {
    let Some(dir) = app_data_dir() else { return };
    let load = load_from(&dir);
    if load != Load::Absent {
        restore_and_clear(&dir, &load, SETTLE);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ME: Owner = Owner { pid: 4242, started: 133_000_000_000_000_000 };
    const MARKER: Marker = Marker { schema: SCHEMA, owner: ME, auto_hide_before: true };

    #[test]
    fn marker_round_trips_through_the_file() {
        let dir = tempfile::tempdir().expect("temp dir");
        store_to(dir.path(), &MARKER).expect("store");
        assert_eq!(load_from(dir.path()), Load::Present(MARKER));
    }

    #[test]
    fn storing_twice_replaces_the_marker_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().expect("temp dir");
        store_to(dir.path(), &MARKER).expect("first store");
        let other = Marker { auto_hide_before: false, ..MARKER };
        store_to(dir.path(), &other).expect("second store");
        assert_eq!(load_from(dir.path()), Load::Present(other));
        let names: Vec<_> =
            std::fs::read_dir(dir.path()).expect("list").map(|e| e.expect("entry").file_name()).collect();
        assert_eq!(names, [std::ffi::OsString::from(MARKER_FILE)]);
    }

    #[test]
    fn missing_file_is_absent_and_clearing_it_is_harmless() {
        let dir = tempfile::tempdir().expect("temp dir");
        assert_eq!(load_from(dir.path()), Load::Absent);
        clear_in(dir.path());
        store_to(dir.path(), &MARKER).expect("store");
        clear_in(dir.path());
        assert_eq!(load_from(dir.path()), Load::Absent);
    }

    #[test]
    fn garbage_and_empty_files_are_unreadable_not_absent() {
        let dir = tempfile::tempdir().expect("temp dir");
        for content in ["", "{", "not json", r#"{"schema":1}"#] {
            std::fs::write(dir.path().join(MARKER_FILE), content).expect("write");
            assert_eq!(load_from(dir.path()), Load::Unreadable, "content {content:?}");
        }
    }

    #[test]
    fn a_marker_directory_in_the_way_is_unreadable() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::create_dir(dir.path().join(MARKER_FILE)).expect("mkdir");
        assert_eq!(load_from(dir.path()), Load::Unreadable);
    }

    #[test]
    fn start_up_restores_when_the_owner_is_gone() {
        assert_eq!(startup_verdict(&Load::Present(MARKER), |_| false), Verdict::PutBack);
    }

    #[test]
    fn start_up_leaves_a_marker_whose_owner_still_runs() {
        assert_eq!(startup_verdict(&Load::Present(MARKER), |owner| *owner == ME), Verdict::Leave);
    }

    #[test]
    fn start_up_with_no_marker_does_nothing() {
        assert_eq!(startup_verdict(&Load::Absent, |_| false), Verdict::Leave);
    }

    #[test]
    fn an_unreadable_marker_is_always_put_back() {
        assert_eq!(startup_verdict(&Load::Unreadable, |_| true), Verdict::PutBack);
        assert_eq!(exit_verdict(&Load::Unreadable, 1), Verdict::PutBack);
        assert_eq!(own_verdict(&Load::Unreadable, Some(ME)), Verdict::PutBack);
    }

    #[test]
    fn the_sentinel_acts_only_on_the_marker_of_the_process_it_watched() {
        assert_eq!(exit_verdict(&Load::Present(MARKER), ME.pid), Verdict::PutBack);
        assert_eq!(exit_verdict(&Load::Present(MARKER), ME.pid + 1), Verdict::Leave);
        assert_eq!(exit_verdict(&Load::Absent, ME.pid), Verdict::Leave);
    }

    #[test]
    fn a_process_restores_its_own_marker_and_not_another_instances() {
        assert_eq!(own_verdict(&Load::Present(MARKER), Some(ME)), Verdict::PutBack);
        let reused_pid = Owner { started: ME.started + 1, ..ME };
        assert_eq!(own_verdict(&Load::Present(MARKER), Some(reused_pid)), Verdict::Leave);
        assert_eq!(own_verdict(&Load::Present(MARKER), None), Verdict::Leave);
        assert_eq!(own_verdict(&Load::Absent, Some(ME)), Verdict::Leave);
    }

    #[test]
    fn the_current_process_is_running_and_a_changed_start_time_is_not() {
        let me = Owner::current().expect("own identity");
        assert!(me.is_running());
        assert!(!Owner { started: me.started + 1, ..me }.is_running());
    }
}

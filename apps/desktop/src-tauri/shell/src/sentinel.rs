//! The restore watchdog. A tiny process that waits on the core's process handle and, when the core
//! ends for any reason (`taskkill /F` and a crash included), puts the taskbar back if the core
//! left it hidden (`dock_guard`). It ends quietly when the core exits cleanly.
//!
//! Two programs run this code: `dotdock-sentinel.exe` next to the core, and the core itself as
//! `dotdock.exe --sentinel ...` when that file is missing (the portable exe, a dev run).
//! Start-up is two steps, `launch` then `watch`: the launcher starts the watcher detached from
//! its own parent and exits, so a tree kill of the core (`taskkill /F /T`) cannot reach the watcher.

use crate::process::Process;
use crate::{boot_log, dock_guard};
use std::io;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Once;
use std::time::{Duration, Instant};
use windows::core::HSTRING;
use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS, HANDLE};
use windows::Win32::System::Threading::{
    CreateMutexW, OpenMutexW, CREATE_BREAKAWAY_FROM_JOB, CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW, DETACHED_PROCESS,
    SYNCHRONIZATION_SYNCHRONIZE,
};

/// Passed first to a program that hosts the sentinel without being `dotdock-sentinel.exe`.
pub const HOST_ARG: &str = "--sentinel";
const EXE_NAME: &str = "dotdock-sentinel.exe";
const MODE_LAUNCH: &str = "launch";
const MODE_WATCH: &str = "watch";
/// One watcher per watched pid; the name lets the core see whether its watcher is alive.
const MUTEX_PREFIX: &str = r"Local\dev.dotdock.sentinel.";
/// How long the core waits for a new watcher to come up.
const START_TIMEOUT: Duration = Duration::from_secs(5);
const START_POLL: Duration = Duration::from_millis(20);
/// How often the core checks its watcher is still there. Bounds the unwatched window after the
/// watcher itself is killed.
const KEEP_EVERY: Duration = Duration::from_secs(1);
/// Exit code for arguments the sentinel does not understand.
const EXIT_USAGE: i32 = 2;
const EXIT_FAILED: i32 = 1;

#[derive(Debug, thiserror::Error)]
pub enum SentinelError {
    #[error("cannot find the running program: {0}")]
    Locate(io::Error),
    #[error("cannot start the sentinel: {0}")]
    Spawn(io::Error),
    #[error("the sentinel did not come up within {0:?}")]
    NotUp(Duration),
}

fn mutex_name(pid: u32) -> HSTRING {
    HSTRING::from(format!("{MUTEX_PREFIX}{pid}"))
}

/// Holds the per-pid mutex for as long as this watcher lives.
struct WatcherLock(HANDLE);

impl Drop for WatcherLock {
    fn drop(&mut self) {
        // SAFETY: the handle came from a successful CreateMutexW and is closed once.
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

impl WatcherLock {
    /// `None` when another watcher already holds the lock for this pid.
    fn take(pid: u32) -> Option<Self> {
        // SAFETY: valid name string; no security attributes; the last error is read right after the call.
        let (handle, existed) = unsafe {
            let handle = CreateMutexW(None, false, &mutex_name(pid)).ok()?;
            (handle, GetLastError() == ERROR_ALREADY_EXISTS)
        };
        let lock = Self(handle);
        (!existed).then_some(lock)
    }
}

/// True while a watcher exists for `pid`.
pub fn is_running(pid: u32) -> bool {
    // SAFETY: valid name string; the handle is closed straight away.
    unsafe {
        OpenMutexW(SYNCHRONIZATION_SYNCHRONIZE, false, &mutex_name(pid)).is_ok_and(|handle| {
            let _ = CloseHandle(handle);
            true
        })
    }
}

/// The program to run and whether it needs `HOST_ARG`: the sentinel exe next to the running
/// program when it exists, otherwise the running program itself.
fn locate() -> io::Result<(PathBuf, bool)> {
    let me = std::env::current_exe()?;
    let sibling = me.with_file_name(EXE_NAME);
    Ok(if sibling.is_file() { (sibling, false) } else { (me, true) })
}

fn command(exe: PathBuf, hosted: bool, mode: &str, pid: u32) -> Command {
    let mut command = Command::new(exe);
    if hosted {
        command.arg(HOST_ARG);
    }
    command.args([mode, &pid.to_string()]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    command
}

/// Makes sure a watcher exists for this process. Waits until it does.
pub fn ensure_running() -> Result<(), SentinelError> {
    let pid = std::process::id();
    if is_running(pid) {
        return Ok(());
    }
    let (exe, hosted) = locate().map_err(SentinelError::Locate)?;
    command(exe, hosted, MODE_LAUNCH, pid).creation_flags(CREATE_NO_WINDOW.0).status().map_err(SentinelError::Spawn)?;
    let deadline = Instant::now() + START_TIMEOUT;
    while !is_running(pid) {
        if Instant::now() >= deadline {
            return Err(SentinelError::NotUp(START_TIMEOUT));
        }
        std::thread::sleep(START_POLL);
    }
    Ok(())
}

/// Starts the watcher for this process and keeps it alive: if something kills it, a new one is
/// started within `KEEP_EVERY`. Idempotent; call before the taskbar is hidden.
pub fn start() -> Result<(), SentinelError> {
    ensure_running()?;
    static KEEPER: Once = Once::new();
    KEEPER.call_once(|| {
        let spawned = std::thread::Builder::new().name("sentinel-keeper".to_owned()).spawn(keep);
        if let Err(err) = spawned {
            boot_log::record(&format!("sentinel: keeper thread not started: {err}"));
        }
    });
    Ok(())
}

fn keep() {
    let pid = std::process::id();
    let mut failing = false;
    loop {
        std::thread::sleep(KEEP_EVERY);
        if is_running(pid) {
            continue;
        }
        match ensure_running() {
            Ok(()) => boot_log::record("sentinel: watcher was gone, started a new one"),
            // One line per outage, not one per second.
            Err(err) if !failing => boot_log::record(&format!("sentinel: watcher is gone and did not restart: {err}")),
            Err(_) => {}
        }
        failing = !is_running(pid);
    }
}

/// Entry point of both programs. `args` are the arguments after the program name.
pub fn run(args: &[String]) -> i32 {
    let (hosted, rest) = match args.split_first() {
        Some((first, rest)) if first == HOST_ARG => (true, rest),
        _ => (false, args),
    };
    let parsed = match rest {
        [mode, pid] => pid.parse::<u32>().ok().map(|pid| (mode.as_str(), pid)),
        _ => None,
    };
    match parsed {
        Some((MODE_LAUNCH, pid)) => launch(hosted, pid),
        Some((MODE_WATCH, pid)) => watch(pid),
        _ => {
            boot_log::record(&format!("sentinel: unrecognised arguments {args:?}"));
            EXIT_USAGE
        }
    }
}

/// Starts the watcher as its own detached process, outside the caller's process tree and job.
fn launch(hosted: bool, pid: u32) -> i32 {
    let spawn = |flags: u32| -> io::Result<()> {
        let exe = std::env::current_exe()?;
        command(exe, hosted, MODE_WATCH, pid).creation_flags(flags).spawn().map(drop)
    };
    let detached = (DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP).0;
    // Leaving the caller's job keeps a job that is closed on exit from taking the watcher along;
    // a job that forbids breaking away only allows the plain detached start.
    let outcome = match spawn(detached | CREATE_BREAKAWAY_FROM_JOB.0) {
        Err(err) if err.raw_os_error().and_then(|code| u32::try_from(code).ok()) == Some(ERROR_ACCESS_DENIED.0) => {
            spawn(detached)
        }
        other => other,
    };
    match outcome {
        Ok(()) => 0,
        Err(err) => {
            boot_log::record(&format!("sentinel: cannot start the watcher for pid {pid}: {err}"));
            EXIT_FAILED
        }
    }
}

/// Waits for `pid` to end, then restores the taskbar if it left it hidden.
fn watch(pid: u32) -> i32 {
    let Some(_lock) = WatcherLock::take(pid) else { return 0 };
    boot_log::record(&format!("sentinel: watching pid {pid}"));
    // A process that is already gone has ended too: its marker still needs acting on.
    if let Some(watched) = Process::open(pid) {
        watched.wait();
    }
    dock_guard::after_owner_ended(pid);
    boot_log::record(&format!("sentinel: pid {pid} ended, done"));
    0
}

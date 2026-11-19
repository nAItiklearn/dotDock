//! System data providers. Each pushes typed payloads to the overlay; the UI never polls.

use dotdock_shell::providers::media::{self, MediaProvider};
use dotdock_shell::providers::{battery, system};
use serde::Serialize;
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const EVENT_DATA: &str = "provider://data";
pub const EVENT_ISSUE: &str = "provider://issue";

/// How often fast-changing values (RAM, CPU, battery) refresh.
const FAST_TICK: Duration = Duration::from_secs(1);
/// Disk usage changes slowly and enumerating volumes is comparatively costly.
const DISK_EVERY: Duration = Duration::from_secs(30);
/// Media state is sampled at this rate but only sent when it changes...
const MEDIA_TICK: Duration = Duration::from_millis(500);
/// ...plus a periodic resync so the UI's extrapolated progress never drifts far.
const MEDIA_RESYNC: Duration = Duration::from_secs(5);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DataEvent<T: Serialize> {
    provider: &'static str,
    data: T,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct IssueEvent {
    provider: &'static str,
    issue: &'static str,
}

/// Set once the overlay has registered its listeners. Events emitted earlier
/// would be dropped, so the provider thread waits for this and then replays at once.
#[derive(Clone, Default)]
pub struct ProvidersReady(Arc<(Mutex<bool>, Condvar)>);

impl ProvidersReady {
    pub fn mark(&self) {
        let (lock, cvar) = &*self.0;
        *lock.lock().unwrap_or_else(PoisonError::into_inner) = true;
        cvar.notify_all();
    }

    fn wait(&self) {
        let (lock, cvar) = &*self.0;
        let mut ready = lock.lock().unwrap_or_else(PoisonError::into_inner);
        while !*ready {
            ready = cvar.wait(ready).unwrap_or_else(PoisonError::into_inner);
        }
    }
}

/// Starts the provider thread. It sleeps until the overlay is listening.
pub fn spawn(app: AppHandle, ready: ProvidersReady) -> std::io::Result<()> {
    let media_app = app.clone();
    let media_ready = ready.clone();
    thread::Builder::new().name("providers".into()).spawn(move || {
        ready.wait();
        run_loop(&app);
    })?;
    // Separate thread: a slow media app must never delay battery or RAM updates.
    thread::Builder::new().name("media".into()).spawn(move || {
        media_ready.wait();
        media_loop(&media_app);
    })?;
    Ok(())
}

fn run_loop(app: &AppHandle) {
    let mut sys = match system::SystemProvider::new() {
        Ok(sys) => Some(sys),
        Err(_) => {
            issue(app, "system", "error");
            None
        }
    };
    let mut last_disk: Option<Instant> = None;
    loop {
        let started = Instant::now();
        let refresh_disks = last_disk.is_none_or(|t| t.elapsed() >= DISK_EVERY);
        if refresh_disks {
            last_disk = Some(started);
        }
        if let Some(sys) = sys.as_mut() {
            emit(app, "system", sys.sample(refresh_disks));
        }

        match battery::read() {
            battery::Reading::Present(data) => emit(app, "battery", data),
            battery::Reading::NoBattery => issue(app, "battery", "no-device"),
            battery::Reading::Unavailable => issue(app, "battery", "error"),
        }

        thread::sleep(FAST_TICK.saturating_sub(started.elapsed()));
    }
}

fn media_loop(app: &AppHandle) {
    let mut provider = MediaProvider::new();
    let mut last: Option<media::MediaData> = None;
    let mut last_sent = Instant::now();
    let mut idle_reported = false;
    loop {
        let started = Instant::now();
        match provider.read() {
            media::Reading::Playing(data) => {
                let changed = last.as_ref().is_none_or(|l| !l.same_track_state(&data));
                if changed || last_sent.elapsed() >= MEDIA_RESYNC {
                    emit(app, "media", data.clone());
                    last_sent = Instant::now();
                }
                last = Some(data);
                idle_reported = false;
            }
            media::Reading::Nothing if !idle_reported => {
                issue(app, "media", "idle");
                last = None;
                idle_reported = true;
            }
            media::Reading::Nothing => {}
            media::Reading::Unavailable => {
                issue(app, "media", "unsupported");
                // The session manager never appears later in a running process; stop polling.
                return;
            }
        }
        thread::sleep(MEDIA_TICK.saturating_sub(started.elapsed()));
    }
}

fn emit<T: Serialize + Clone>(app: &AppHandle, provider: &'static str, data: T) {
    // A failed emit only means the overlay is gone (shutting down); nothing to recover.
    let _ = app.emit(EVENT_DATA, DataEvent { provider, data });
}

fn issue(app: &AppHandle, provider: &'static str, issue: &'static str) {
    let _ = app.emit(EVENT_ISSUE, IssueEvent { provider, issue });
}

//! System data providers. Each pushes typed payloads to the overlay; the UI never polls.

use dotdock_shell::providers::media::{self, MediaProvider};
use dotdock_shell::providers::{battery, system, weather};
use dotdock_shell::run_gate::{RunGate, Wait};
use serde::Serialize;
use std::sync::mpsc::RecvTimeoutError;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const EVENT_DATA: &str = "provider://data";
pub const EVENT_ISSUE: &str = "provider://issue";

/// How often fast-changing values (RAM, CPU, battery) refresh.
const FAST_TICK: Duration = Duration::from_secs(1);
/// Disk usage changes slowly and enumerating volumes is comparatively costly.
const DISK_EVERY: Duration = Duration::from_secs(30);
/// Open-Meteo updates its model hourly; 30 min keeps the widget fresh without waste.
const WEATHER_REFRESH: Duration = Duration::from_secs(30 * 60);
/// After a failed fetch (offline, timeout), retry sooner than the normal refresh.
const WEATHER_RETRY: Duration = Duration::from_secs(2 * 60);

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

/// Starts the provider threads, adding each to `threads` so the caller can join them. They wait for the
/// gate to open (the overlay is listening), then push until the gate is stopped.
pub fn spawn(app: &AppHandle, gate: &RunGate, threads: &mut Vec<JoinHandle<()>>) -> std::io::Result<()> {
    for (name, run) in [
        ("providers", run_loop as fn(&AppHandle, &RunGate)),
        // Separate thread: a slow media app must never delay battery or RAM updates.
        ("media", media_loop),
        ("weather", weather_loop),
    ] {
        let (app, gate) = (app.clone(), gate.clone());
        threads.push(thread::Builder::new().name(name.into()).spawn(move || {
            if gate.wait_open() {
                run(&app, &gate);
            }
        })?);
    }
    Ok(())
}

fn run_loop(app: &AppHandle, gate: &RunGate) {
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

        if !gate.pause(FAST_TICK.saturating_sub(started.elapsed())) {
            return;
        }
    }
}

/// Event-driven: the media session wakes this thread; between events it sleeps on the channel. Stopping the
/// gate wakes it too, so the home screen part can stop without waiting for a track change.
fn media_loop(app: &AppHandle, gate: &RunGate) {
    let (wake, events) = std::sync::mpsc::channel();
    let on_stop = wake.clone();
    let stop_gate = gate.clone();
    if let Err(error) = thread::Builder::new().name("media-stop".into()).spawn(move || {
        stop_gate.wait_stopped();
        let _ = on_stop.send(());
    }) {
        dotdock_shell::boot_log::record(&format!("media: no stop watcher: {error}"));
        return;
    }
    let mut provider = MediaProvider::new();
    provider.watch(wake);
    let mut last_sent: Option<media::MediaData> = None;
    let mut idle_reported = false;
    loop {
        let reading = provider.read();
        let retry = provider.retry_after(&reading);
        match media::next_update(last_sent.as_ref(), idle_reported, reading) {
            media::Update::Send(data) => {
                emit(app, "media", data.clone());
                last_sent = Some(data);
                idle_reported = false;
            }
            media::Update::Idle => {
                issue(app, "media", "no-device");
                last_sent = None;
                idle_reported = true;
            }
            media::Update::Keep => {}
            media::Update::Stop => {
                issue(app, "media", "unsupported");
                return;
            }
        }
        let woken = match retry {
            Some(after) => events.recv_timeout(after).map_err(|e| e == RecvTimeoutError::Disconnected),
            None => events.recv().map_err(|_| true),
        };
        if woken == Err(true) || gate.is_stopped() {
            return;
        }
        // One read covers a burst of events (a track change raises several at once).
        while events.try_recv().is_ok() {}
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn weather_loop(app: &AppHandle, gate: &RunGate) {
    loop {
        let wait = match weather::saved_place() {
            None => {
                issue(app, "weather", "needs-setup");
                None
            }
            Some(place) => match weather::fetch(&place, now_ms()) {
                Ok(data) => {
                    // The cache only speeds up the next boot; a failed write changes nothing now.
                    let _ = weather::store_cache(&data);
                    emit(app, "weather", data);
                    Some(WEATHER_REFRESH)
                }
                Err(_) => {
                    // Keep showing the last good reading (marked stale) and say why.
                    if let Some(cached) = weather::cached().filter(|c| c.place == place.name) {
                        emit(app, "weather", cached);
                    }
                    issue(app, "weather", "offline");
                    Some(WEATHER_RETRY)
                }
            },
        };
        if gate.wait_nudge(wait) == Wait::Stopped {
            return;
        }
    }
}

fn emit<T: Serialize + Clone>(app: &AppHandle, provider: &'static str, data: T) {
    // A failed emit only means the overlay is gone (shutting down); nothing to recover.
    let _ = app.emit(EVENT_DATA, DataEvent { provider, data });
}

fn issue(app: &AppHandle, provider: &'static str, issue: &'static str) {
    let _ = app.emit(EVENT_ISSUE, IssueEvent { provider, issue });
}

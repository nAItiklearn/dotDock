//! System data providers. Each pushes typed payloads to the overlay; the UI never polls.

use dotdock_shell::providers::media::{self, MediaProvider};
use dotdock_shell::providers::{battery, system, weather};
use serde::Serialize;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
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
/// Media state is sampled at this rate but only sent when it changes or the clock drifts (a seek).
const MEDIA_TICK: Duration = Duration::from_millis(500);
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

/// Wakes the weather thread immediately, e.g. after the user picks a new place.
#[derive(Clone)]
pub struct WeatherWake(Sender<()>);

impl WeatherWake {
    pub fn wake(&self) {
        // The receiver only disappears at shutdown.
        let _ = self.0.send(());
    }
}

/// Starts the provider threads. They sleep until the overlay is listening.
pub fn spawn(app: AppHandle, ready: ProvidersReady) -> std::io::Result<WeatherWake> {
    let media_app = app.clone();
    let media_ready = ready.clone();
    let app_for_weather = app.clone();
    let ready_for_weather = ready.clone();
    thread::Builder::new().name("providers".into()).spawn(move || {
        ready.wait();
        run_loop(&app);
    })?;
    // Separate thread: a slow media app must never delay battery or RAM updates.
    thread::Builder::new().name("media".into()).spawn(move || {
        media_ready.wait();
        media_loop(&media_app);
    })?;
    let (wake_tx, wake_rx) = std::sync::mpsc::channel();
    let weather_app = app_for_weather;
    let weather_ready = ready_for_weather;
    thread::Builder::new().name("weather".into()).spawn(move || {
        weather_ready.wait();
        weather_loop(&weather_app, &wake_rx);
    })?;
    Ok(WeatherWake(wake_tx))
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
    let mut last_sent: Option<media::MediaData> = None;
    let mut idle_reported = false;
    loop {
        let started = Instant::now();
        match provider.read() {
            media::Reading::Playing(data) => {
                let changed = last_sent.as_ref().is_none_or(|l| !l.same_track_state(&data) || l.clock_drifted(&data));
                if changed {
                    emit(app, "media", data.clone());
                    last_sent = Some(data);
                }
                idle_reported = false;
            }
            media::Reading::Nothing if !idle_reported => {
                issue(app, "media", "idle");
                last_sent = None;
                idle_reported = true;
            }
            media::Reading::Nothing | media::Reading::Transient => {}
            media::Reading::Unavailable => {
                issue(app, "media", "unsupported");
                // The session manager never appears later in a running process; stop polling.
                return;
            }
        }
        thread::sleep(MEDIA_TICK.saturating_sub(started.elapsed()));
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn weather_loop(app: &AppHandle, wake: &Receiver<()>) {
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
        let woke = match wait {
            Some(d) => wake.recv_timeout(d),
            None => wake.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        if matches!(woke, Err(RecvTimeoutError::Disconnected)) {
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

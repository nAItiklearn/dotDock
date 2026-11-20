//! Measures what the service costs: a cold start (empty cache), a warm start (nothing extracted, nothing
//! rescanned), and the CPU and memory of the whole process while it idles.
//! Run: `cargo run --release -p dotdock-dock --example idle_probe -- <scratch folder> [idle seconds]`

use dotdock_dock::protocol::DockEvent;
use dotdock_dock::service::{DockService, ServiceConfig};
use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};
use windows::Win32::Foundation::FILETIME;
use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

const DEFAULT_IDLE_SECONDS: u64 = 60;
const START_TIMEOUT: Duration = Duration::from_secs(60);
/// 100 ns FILETIME ticks per second.
const TICKS_PER_SECOND: f64 = 10_000_000.0;

fn ticks(t: FILETIME) -> u64 {
    (u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime)
}

/// Kernel plus user CPU time of this process so far, in seconds.
fn cpu_seconds() -> f64 {
    let (mut created, mut exited, mut kernel, mut user) =
        (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
    // SAFETY: plain query of our own process.
    unsafe {
        let _ = GetProcessTimes(GetCurrentProcess(), &mut created, &mut exited, &mut kernel, &mut user);
    }
    (ticks(kernel) + ticks(user)) as f64 / TICKS_PER_SECOND
}

/// Working set and peak working set in MB.
fn memory_mb() -> (f64, f64) {
    let mut counters =
        PROCESS_MEMORY_COUNTERS { cb: size_of::<PROCESS_MEMORY_COUNTERS>() as u32, ..Default::default() };
    // SAFETY: plain query of our own process.
    unsafe {
        let _ = GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.cb);
    }
    (counters.WorkingSetSize as f64 / 1_048_576.0, counters.PeakWorkingSetSize as f64 / 1_048_576.0)
}

/// Time until an `Apps` event with apps in it arrives.
fn first_apps(events: &Receiver<DockEvent>, started: Instant) -> Option<(Duration, usize)> {
    while let Some(left) = START_TIMEOUT.checked_sub(started.elapsed()) {
        if let Ok(DockEvent::Apps(apps)) = events.recv_timeout(left) {
            if !apps.is_empty() {
                return Some((started.elapsed(), apps.len()));
            }
        }
    }
    None
}

fn main() {
    let scratch = PathBuf::from(std::env::args().nth(1).expect("scratch folder"));
    let idle =
        Duration::from_secs(std::env::args().nth(2).and_then(|s| s.parse().ok()).unwrap_or(DEFAULT_IDLE_SECONDS));
    let config = || ServiceConfig { data_dir: scratch.join("data"), icon_dir: scratch.join("icons") };
    let _ = std::fs::remove_dir_all(&scratch);

    // Cold: nothing on disk. Wait until the scan is in and every icon is extracted.
    let started = Instant::now();
    let (service, events) = DockService::start(config()).expect("start");
    let (to_apps, count) = first_apps(&events, started).expect("apps");
    while service.stats().icons_extracted < count as u64 && started.elapsed() < START_TIMEOUT {
        std::thread::sleep(Duration::from_millis(100));
    }
    let stats = service.stats();
    println!(
        "cold start: first apps after {to_apps:?} ({count} apps), all icons extracted after {:?} ({} extracted)",
        started.elapsed(),
        stats.icons_extracted
    );
    std::thread::sleep(Duration::from_secs(3));
    drop(service);

    // Warm: the cache of the first run. A window that opened since (a program with no catalogue entry) has no
    // icon yet, so the first warm start may extract one or two of those; the second extracts none.
    let (service, events) = DockService::start(config()).expect("start");
    std::thread::sleep(Duration::from_secs(5));
    println!(
        "first warm start: icons extracted {} (windows opened since the cold run)",
        service.stats().icons_extracted
    );
    drop((service, events));

    let started = Instant::now();
    let (service, events) = DockService::start(config()).expect("start");
    let (to_apps, count) = first_apps(&events, started).expect("apps");
    let snapshot = service.snapshot();
    println!("warm start: first apps after {to_apps:?} ({count} apps), snapshot built in {:?}", started.elapsed());
    std::thread::sleep(Duration::from_secs(5));
    let stats = service.stats();
    println!(
        "warm start: icons extracted {} (must be 0), catalogue cache writes {}",
        stats.icons_extracted, stats.cache_writes
    );
    println!("snapshot: {} apps, {} windows", snapshot.apps.len(), snapshot.windows.len());
    for window in &snapshot.windows {
        // App ids only: a title could hold anything the user has open.
        println!("  window of app {:?} (icon {})", window.app_id.as_deref().unwrap_or("none"), window.icon);
    }

    // Idle: measure the whole process, which also holds the probe's own threads.
    let before_stats = service.stats();
    let (cpu_before, started) = (cpu_seconds(), Instant::now());
    std::thread::sleep(idle);
    let (cpu_after, elapsed) = (cpu_seconds(), started.elapsed());
    let after_stats = service.stats();
    let (working_set, peak) = memory_mb();
    println!(
        "idle {elapsed:.0?}: CPU {:.3} s of one core = {:.3} %, working set {working_set:.1} MB (peak {peak:.1} MB)",
        cpu_after - cpu_before,
        (cpu_after - cpu_before) / elapsed.as_secs_f64() * 100.0
    );
    println!(
        "idle {elapsed:.0?}: sensor signals {}, window recomputes {}, store writes {}, cache writes {}, icons extracted {}",
        after_stats.signals - before_stats.signals,
        after_stats.window_recomputes - before_stats.window_recomputes,
        after_stats.store_writes - before_stats.store_writes,
        after_stats.cache_writes - before_stats.cache_writes,
        after_stats.icons_extracted - before_stats.icons_extracted
    );
    println!("frozen state: {:?}", service.frozen());
    println!("sensor registrations: {:?}", service.registrations());
}

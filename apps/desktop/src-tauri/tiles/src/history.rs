//! System history for the graph tiles: CPU, memory, disk activity and network speed, one sample per second, the
//! last 60 kept.
//!
//! Sampling runs only while a history tile is subscribed (visible); otherwise there is no thread and no timer.
//! CPU and memory come from the shell crate's `SystemProvider`, network from the adapters' byte counters, and
//! disk from the same performance counter Task Manager's "Active time" uses.

use crate::com::{Refresh, Worker};
use crate::emit::{lock, shared, Emitter, Shared};
use crate::protocol::{SystemHistory, TileData};
use dotdock_shell::providers::system::SystemProvider;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use sysinfo::Networks;
use windows::core::PCWSTR;
use windows::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterValue, PdhOpenQueryW,
    PDH_FMT_COUNTERVALUE, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
};

/// Samples kept per metric (one minute at one sample a second).
pub const CAPACITY: usize = 60;
/// Seconds between samples while a tile is subscribed.
pub const INTERVAL: Duration = Duration::from_secs(1);
/// The disk counter: share of time the physical disks were not idle is 100 minus this.
const DISK_IDLE_COUNTER: &str = r"\PhysicalDisk(_Total)\% Idle Time";
/// The CPU usage reading needs this long between two refreshes to mean anything.
const CPU_PRIME: Duration = Duration::from_millis(300);
/// Adapters that carry no real traffic.
const IGNORED_ADAPTERS: [&str; 2] = ["loopback", "pseudo-interface"];

/// A fixed-length history, oldest first.
#[derive(Clone, Debug)]
pub struct Ring<T> {
    items: VecDeque<T>,
}

impl<T: Clone> Ring<T> {
    pub fn new() -> Self {
        Self { items: VecDeque::with_capacity(CAPACITY) }
    }

    pub fn push(&mut self, value: T) {
        if self.items.len() == CAPACITY {
            self.items.pop_front();
        }
        self.items.push_back(value);
    }

    pub fn to_vec(&self) -> Vec<T> {
        self.items.iter().cloned().collect()
    }
}

impl<T: Clone> Default for Ring<T> {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Default)]
struct Rings {
    cpu: Ring<f32>,
    memory: Ring<f32>,
    disk: Ring<f32>,
    net_down: Ring<f64>,
    net_up: Ring<f64>,
    memory_used: u64,
    memory_total: u64,
}

impl Rings {
    fn snapshot(&self) -> SystemHistory {
        SystemHistory {
            interval_secs: INTERVAL.as_secs(),
            cpu: self.cpu.to_vec(),
            memory: self.memory.to_vec(),
            disk: self.disk.to_vec(),
            net_down: self.net_down.to_vec(),
            net_up: self.net_up.to_vec(),
            capacity: CAPACITY,
            memory_used_bytes: self.memory_used,
            memory_total_bytes: self.memory_total,
        }
    }
}

fn counts_traffic(adapter: &str) -> bool {
    let lower = adapter.to_lowercase();
    !IGNORED_ADAPTERS.iter().any(|i| lower.contains(i))
}

/// Active share of the physical disks, 0 to 1, from the Windows performance counters.
struct DiskCounter {
    query: PDH_HQUERY,
    counter: PDH_HCOUNTER,
}

impl DiskCounter {
    fn open() -> Option<Self> {
        let path = crate::com::wide(DISK_IDLE_COUNTER);
        let (mut query, mut counter) = (PDH_HQUERY::default(), PDH_HCOUNTER::default());
        // SAFETY: handles are written by the calls and released in Drop; the path is NUL-terminated.
        unsafe {
            if PdhOpenQueryW(PCWSTR::null(), 0, &mut query) != 0 {
                return None;
            }
            if PdhAddEnglishCounterW(query, PCWSTR(path.as_ptr()), 0, &mut counter) != 0 {
                PdhCloseQuery(query);
                return None;
            }
            // A rate counter needs two collections; this is the first.
            PdhCollectQueryData(query);
        }
        Some(Self { query, counter })
    }

    fn active_share(&self) -> Option<f32> {
        let mut value = PDH_FMT_COUNTERVALUE::default();
        // SAFETY: the query and counter are alive; `value` is written by the call.
        unsafe {
            if PdhCollectQueryData(self.query) != 0 {
                return None;
            }
            if PdhGetFormattedCounterValue(self.counter, PDH_FMT_DOUBLE, None, &mut value) != 0 {
                return None;
            }
            let idle = value.Anonymous.doubleValue;
            Some(((100.0 - idle) / 100.0).clamp(0.0, 1.0) as f32)
        }
    }
}

impl Drop for DiskCounter {
    fn drop(&mut self) {
        // SAFETY: closes the query opened in `open`.
        unsafe { PdhCloseQuery(self.query) };
    }
}

pub struct History {
    emitter: Emitter,
    rings: Shared<Rings>,
    worker: Mutex<Option<Worker<Refresh>>>,
}

impl History {
    pub fn new(emitter: Emitter) -> Self {
        Self { emitter, rings: shared(Rings::default()), worker: Mutex::new(None) }
    }

    pub fn start(&self) -> Result<(), String> {
        let mut slot = lock(&self.worker);
        if slot.is_some() {
            return Ok(());
        }
        *lock(&self.rings) = Rings::default();
        let (rings, emitter) = (self.rings.clone(), self.emitter.clone());
        let worker = Worker::spawn("tiles-history", move |rx, _tx| {
            let mut system = SystemProvider::new().ok();
            let mut networks = Networks::new_with_refreshed_list().ok();
            let disk = DiskCounter::open();
            // Prime the delta-based readings so the first sample is real.
            std::thread::sleep(CPU_PRIME);
            if let Some(s) = system.as_mut() {
                s.sample(false);
            }
            if let Some(n) = networks.as_mut() {
                n.refresh(true);
            }
            let mut last = Instant::now();
            loop {
                match rx.recv_timeout(INTERVAL) {
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    _ => break,
                }
                let seconds = last.elapsed().as_secs_f64().max(0.001);
                last = Instant::now();
                let (down, up) = networks.as_mut().map_or((0, 0), |n| {
                    n.refresh(true);
                    n.iter()
                        .filter(|(name, _)| counts_traffic(&name.to_string_lossy()))
                        .fold((0u64, 0u64), |(d, u), (_, data)| (d + data.received(), u + data.transmitted()))
                });
                let mut r = lock(&rings);
                if let Some(s) = system.as_mut() {
                    let d = s.sample(false);
                    r.cpu.push((d.cpu_percent / 100.0).clamp(0.0, 1.0));
                    r.memory.push(if d.mem_total_bytes == 0 {
                        0.0
                    } else {
                        (d.mem_used_bytes as f64 / d.mem_total_bytes as f64) as f32
                    });
                    r.memory_used = d.mem_used_bytes;
                    r.memory_total = d.mem_total_bytes;
                }
                if let Some(share) = disk.as_ref().and_then(DiskCounter::active_share) {
                    r.disk.push(share);
                }
                r.net_down.push(down as f64 / seconds);
                r.net_up.push(up as f64 / seconds);
                let snapshot = r.snapshot();
                drop(r);
                emitter.emit(TileData::SystemHistory(snapshot));
            }
        })
        .map_err(|e| format!("could not start the history sampler: {e}"))?;
        *slot = Some(worker);
        Ok(())
    }

    pub fn stop(&self) {
        let worker = lock(&self.worker).take();
        drop(worker);
        *lock(&self.rings) = Rings::default();
    }

    pub fn state(&self) -> SystemHistory {
        lock(&self.rings).snapshot()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_ring_keeps_only_the_last_sixty() {
        let mut ring = Ring::new();
        for i in 0..CAPACITY + 10 {
            ring.push(i as f32);
        }
        let v = ring.to_vec();
        assert_eq!(v.len(), CAPACITY);
        assert_eq!(v[0], 10.0);
        assert_eq!(*v.last().unwrap(), (CAPACITY + 9) as f32);
    }

    #[test]
    fn loopback_traffic_is_not_counted() {
        assert!(!counts_traffic("Loopback Pseudo-Interface 1"));
        assert!(counts_traffic("Wi-Fi"));
    }

    #[test]
    fn the_disk_counter_reads_a_share() {
        if let Some(counter) = DiskCounter::open() {
            std::thread::sleep(Duration::from_millis(300));
            let share = counter.active_share().expect("a reading");
            assert!((0.0..=1.0).contains(&share));
        }
    }

    #[test]
    fn samples_arrive_once_a_second_only_while_running() {
        let (tx, rx) = std::sync::mpsc::channel();
        let h = History::new(Emitter::new(move |d| {
            let _ = tx.send(d);
        }));
        h.start().unwrap();
        let first = rx.recv_timeout(Duration::from_secs(4)).expect("a sample");
        let TileData::SystemHistory(s) = first else { panic!("wrong tile") };
        assert_eq!(s.cpu.len(), 1);
        assert!(s.memory_total_bytes > 0);
        h.stop();
        while rx.try_recv().is_ok() {}
        assert!(rx.recv_timeout(Duration::from_millis(2500)).is_err(), "nothing is sampled after stop");
    }
}

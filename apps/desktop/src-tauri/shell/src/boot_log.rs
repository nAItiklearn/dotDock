//! Boot timing: milliseconds from process start to each boot stage, appended to
//! `%LOCALAPPDATA%\dev.dotdock.desktop\boot.log` so autostart strategies can be compared.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const LOG_FILE: &str = "boot.log";

static START: OnceLock<Instant> = OnceLock::new();

fn log_path() -> Option<PathBuf> {
    crate::app_data_dir().map(|d| d.join(LOG_FILE))
}

/// Appends one timestamped line. Boot logging must never take the app down, so failures are dropped.
pub fn record(line: &str) {
    let Some(path) = log_path() else { return };
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let unix_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        let _ = writeln!(f, "{unix_ms} {line}");
    }
}

/// Marks process start; every later stage is measured from here.
pub fn record_process_start() {
    START.get_or_init(Instant::now);
    let args: Vec<String> = std::env::args().skip(1).collect();
    record(&format!("start args={args:?}"));
}

/// Logs a named boot stage with milliseconds since process start.
pub fn mark(stage: &str) {
    let elapsed = START.get().map(|s| s.elapsed().as_millis()).unwrap_or(0);
    record(&format!("{stage} ms={elapsed}"));
}

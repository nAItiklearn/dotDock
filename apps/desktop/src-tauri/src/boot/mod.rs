//! Boot timing: records how long it takes from process start to the first visible frame.
//! `tools/measure-boot` reads the log to compare autostart strategies.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const APP_DIR: &str = "dotDock";
const LOG_FILE: &str = "boot.log";

static START: OnceLock<Instant> = OnceLock::new();

fn log_path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    let dir = PathBuf::from(base).join(APP_DIR);
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join(LOG_FILE))
}

fn append(line: &str) {
    let Some(path) = log_path() else { return };
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let unix_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        // Boot logging must never take the app down; a lost line is acceptable.
        let _ = writeln!(f, "{unix_ms} {line}");
    }
}

pub fn record_process_start() {
    START.get_or_init(Instant::now);
    let args: Vec<String> = std::env::args().skip(1).collect();
    append(&format!("start args={args:?}"));
}

/// Logs a named boot stage with milliseconds since process start.
pub fn mark(stage: &str) {
    let elapsed = START.get().map(|s| s.elapsed().as_millis()).unwrap_or(0);
    append(&format!("{stage} ms={elapsed}"));
}

pub fn record_fatal(message: &str) {
    append(&format!("fatal {message}"));
}

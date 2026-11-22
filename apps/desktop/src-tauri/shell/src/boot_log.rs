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

/// One stage of the last start: its name and milliseconds since the process started.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Stage {
    pub name: String,
    pub ms: u64,
}

/// The last start in the log: when it began (Unix ms) and its stages in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LastBoot {
    pub started_unix_ms: u64,
    pub stages: Vec<Stage>,
}

/// Reads the newest `start` line and the stage lines after it from log text.
pub fn parse_last_boot(text: &str) -> Option<LastBoot> {
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.iter().rposition(|l| l.split_once(' ').is_some_and(|(_, rest)| rest.starts_with("start ")))?;
    let started_unix_ms = lines[start].split_once(' ')?.0.parse().ok()?;
    let stages = lines[start + 1..]
        .iter()
        .filter_map(|l| {
            let (_, rest) = l.split_once(' ')?;
            let (name, ms) = rest.split_once(" ms=")?;
            Some(Stage { name: name.to_owned(), ms: ms.trim().parse().ok()? })
        })
        .collect();
    Some(LastBoot { started_unix_ms, stages })
}

pub fn last_boot() -> Option<LastBoot> {
    parse_last_boot(&std::fs::read_to_string(log_path()?).ok()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_last_start_and_only_its_stages_are_read() {
        let log = "100 start args=[]
200 setup ms=12
300 start args=[\"--autostart\"]
310 setup ms=9
                   320 island alert: Claude finished
330 shown ms=480
";
        let boot = parse_last_boot(log).expect("a start");
        assert_eq!(boot.started_unix_ms, 300);
        assert_eq!(boot.stages, vec![Stage { name: "setup".into(), ms: 9 }, Stage { name: "shown".into(), ms: 480 }]);
        assert_eq!(
            parse_last_boot(
                "100 setup ms=3
"
            ),
            None
        );
    }
}

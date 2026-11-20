//! Crash-loop guard (MASTER_SPEC 1.2): if the app dies 3 times within 5 minutes of starting,
//! it restores stock Windows, disables autostart, and says why on the next manual launch.
//! Also records panics to the boot log, since release builds abort without a console.

use crate::{boot_log, dock_guard, restore};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const FILE: &str = "crash-guard.json";
/// A run that ends before this counts as a crash-loop candidate.
const UNSTABLE_WINDOW: Duration = Duration::from_secs(5 * 60);
const MAX_UNSTABLE_STARTS: usize = 3;

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct State {
    /// Unix ms of starts that have not yet been marked stable.
    unstable_starts: Vec<u64>,
    /// Set when the guard tripped; cleared once the user has seen the notice.
    tripped_at: Option<u64>,
}

fn path() -> Option<PathBuf> {
    crate::app_data_dir().map(|d| d.join(FILE))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX)).unwrap_or(0)
}

fn load() -> State {
    path().and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(state: &State) {
    let Some(p) = path() else { return };
    let tmp = p.with_extension("tmp");
    // The guard must never be the thing that crashes the app; a failed write only weakens it.
    if let Ok(json) = serde_json::to_vec(state) {
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, &p);
        }
    }
}

pub enum StartDecision {
    /// Normal start.
    Proceed,
    /// The guard just tripped: Windows was restored. Start in safe mode and show the notice.
    Tripped,
}

/// Call first thing at startup.
pub fn on_start() -> StartDecision {
    let mut state = load();
    let now = now_ms();
    let window_ms = u64::try_from(UNSTABLE_WINDOW.as_millis()).unwrap_or(u64::MAX);
    // Starts older than the window can no longer be part of a loop.
    state.unstable_starts.retain(|&t| now.saturating_sub(t) < window_ms);
    state.unstable_starts.push(now);
    if state.unstable_starts.len() >= MAX_UNSTABLE_STARTS {
        boot_log::record("crash-guard: tripped, restoring Windows");
        let outcome = restore::restore_windows();
        boot_log::record(&format!("crash-guard: restore {outcome:?}"));
        state.unstable_starts.clear();
        state.tripped_at = Some(now);
        save(&state);
        return StartDecision::Tripped;
    }
    save(&state);
    StartDecision::Proceed
}

/// Call once the app has run long enough to count as stable; clears this start from the count.
pub fn mark_stable() {
    let mut state = load();
    state.unstable_starts.clear();
    save(&state);
}

/// How long after start to call `mark_stable`.
pub fn stable_after() -> Duration {
    UNSTABLE_WINDOW
}

/// The guard tripped earlier and the user has not been told yet. Clears the flag.
pub fn take_tripped_notice() -> Option<u64> {
    let mut state = load();
    let at = state.tripped_at.take()?;
    save(&state);
    Some(at)
}

/// Writes panics (any thread) to the boot log and puts the taskbar back if this process hid it,
/// before the process aborts. The sentinel is the backstop when even this cannot run.
pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let location = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_owned())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_default();
        let thread = std::thread::current().name().unwrap_or("unnamed").to_owned();
        boot_log::record(&format!("panic thread={thread} at={location} {message}"));
        dock_guard::restore_after_dock();
    }));
}

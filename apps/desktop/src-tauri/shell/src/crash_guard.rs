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
    let now = now_ms();
    let (state, tripped) = count_start(load(), now);
    if tripped {
        boot_log::record("crash-guard: tripped, restoring Windows");
        let outcome = restore::restore_windows();
        boot_log::record(&format!("crash-guard: restore {outcome:?}"));
    }
    save(&state);
    if tripped {
        StartDecision::Tripped
    } else {
        StartDecision::Proceed
    }
}

/// Counts a start at `now` (Unix ms): whether it makes a crash loop, and the state to keep. A loop is the third start
/// within `UNSTABLE_WINDOW` with no stable run between; tripping clears the count and remembers when.
fn count_start(mut state: State, now: u64) -> (State, bool) {
    let window_ms = u64::try_from(UNSTABLE_WINDOW.as_millis()).unwrap_or(u64::MAX);
    // Starts older than the window can no longer be part of a loop.
    state.unstable_starts.retain(|&t| now.saturating_sub(t) < window_ms);
    state.unstable_starts.push(now);
    if state.unstable_starts.len() >= MAX_UNSTABLE_STARTS {
        state.unstable_starts.clear();
        state.tripped_at = Some(now);
        return (state, true);
    }
    (state, false)
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

#[cfg(test)]
mod tests {
    use super::*;

    const MINUTE: u64 = 60_000;

    fn starts(at: &[u64]) -> (State, bool) {
        let mut state = State::default();
        let mut tripped = false;
        for &t in at {
            (state, tripped) = count_start(state, t);
        }
        (state, tripped)
    }

    #[test]
    fn the_third_quick_start_trips_the_guard() {
        assert!(!starts(&[0]).1);
        assert!(!starts(&[0, MINUTE]).1);
        let (state, tripped) = starts(&[0, MINUTE, 2 * MINUTE]);
        assert!(tripped);
        assert_eq!(state.tripped_at, Some(2 * MINUTE));
        assert!(state.unstable_starts.is_empty(), "tripping starts the count again");
    }

    #[test]
    fn starts_spread_beyond_the_window_never_trip_it() {
        assert!(!starts(&[0, 3 * MINUTE, 6 * MINUTE, 9 * MINUTE, 12 * MINUTE]).1);
    }

    #[test]
    fn a_stable_run_in_between_resets_the_count() {
        let (mut state, _) = starts(&[0, MINUTE]);
        state.unstable_starts.clear(); // what `mark_stable` writes
        let (_, tripped) = count_start(state, 2 * MINUTE);
        assert!(!tripped);
    }
}

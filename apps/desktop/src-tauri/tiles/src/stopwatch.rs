//! Stopwatch with laps. The core owns the state, so every dock window shows the same time and a restart changes
//! nothing: times are Unix milliseconds from one clock, and a running stopwatch simply keeps counting from when it
//! was started. The UI draws the digits itself from `started_at` and `banked_ms`; nothing here ticks.

use crate::emit::lock;
use crate::paths;
use crate::wire::{StopwatchOp, StopwatchView};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

/// A stopwatch holds this many laps; the list is for a workout, not a log.
pub const MAX_LAPS: usize = 200;

#[derive(Serialize, Deserialize, Default, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase", default)]
struct State {
    /// When the current run began; absent while stopped.
    started_at: Option<i64>,
    /// Time collected before the current run.
    banked_ms: i64,
    /// Elapsed time at each lap press, in order.
    laps: Vec<i64>,
}

impl State {
    fn elapsed(&self, now: i64) -> i64 {
        self.banked_ms + self.started_at.map_or(0, |started| (now - started).max(0))
    }

    fn apply(&mut self, op: StopwatchOp, now: i64) -> Result<(), String> {
        match op {
            StopwatchOp::Start => {
                self.started_at.get_or_insert(now);
            }
            StopwatchOp::Pause => {
                if self.started_at.is_some() {
                    self.banked_ms = self.elapsed(now);
                    self.started_at = None;
                }
            }
            StopwatchOp::Lap => {
                let total = self.elapsed(now);
                // A press before any time has passed since the last lap is a double tap, not a lap.
                if total > self.laps.last().copied().unwrap_or(0) {
                    if self.laps.len() >= MAX_LAPS {
                        return Err(format!("The stopwatch holds up to {MAX_LAPS} laps"));
                    }
                    self.laps.push(total);
                }
            }
            StopwatchOp::Reset => *self = Self::default(),
        }
        Ok(())
    }

    fn view(&self) -> StopwatchView {
        StopwatchView {
            running: self.started_at.is_some(),
            started_at: self.started_at,
            banked_ms: self.banked_ms,
            laps: self.laps.clone(),
        }
    }
}

pub struct Stopwatch {
    file: PathBuf,
    state: Mutex<State>,
    changed: Box<dyn Fn(StopwatchView) + Send + Sync>,
}

impl Stopwatch {
    /// `changed` is called with the new view after every command that changed something.
    pub fn new(file: PathBuf, changed: impl Fn(StopwatchView) + Send + Sync + 'static) -> Self {
        let state = paths::read_json::<State>(&file).unwrap_or_default();
        Self { file, state: Mutex::new(state), changed: Box::new(changed) }
    }

    pub fn view(&self) -> StopwatchView {
        lock(&self.state).view()
    }

    /// Applies a command at `now`, saves the result, and reports it. Nothing changes if it cannot be saved.
    pub fn command(&self, op: StopwatchOp, now: i64) -> Result<(), String> {
        let mut state = lock(&self.state);
        let mut next = state.clone();
        next.apply(op, now)?;
        if next == *state {
            return Ok(());
        }
        paths::write_json(&self.file, &next).map_err(|e| format!("The stopwatch could not be saved: {e}"))?;
        *state = next;
        let view = state.view();
        drop(state);
        (self.changed)(view);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{channel, Receiver};

    fn stopwatch(file: PathBuf) -> (Stopwatch, Receiver<StopwatchView>) {
        let (tx, rx) = channel();
        (Stopwatch::new(file, move |v| drop(tx.send(v))), rx)
    }

    #[test]
    fn it_counts_from_the_start_and_keeps_the_time_when_paused() {
        let mut s = State::default();
        s.apply(StopwatchOp::Start, 1_000).unwrap();
        assert_eq!(s.elapsed(4_500), 3_500);
        s.apply(StopwatchOp::Pause, 5_000).unwrap();
        assert_eq!((s.started_at, s.banked_ms), (None, 4_000));
        assert_eq!(s.elapsed(60_000), 4_000, "a paused stopwatch does not move");
        s.apply(StopwatchOp::Start, 10_000).unwrap();
        assert_eq!(s.elapsed(10_250), 4_250, "it carries on from the banked time");
    }

    #[test]
    fn starting_twice_does_not_restart_the_run() {
        let mut s = State::default();
        s.apply(StopwatchOp::Start, 1_000).unwrap();
        s.apply(StopwatchOp::Start, 9_000).unwrap();
        assert_eq!(s.started_at, Some(1_000));
    }

    #[test]
    fn laps_record_the_elapsed_time_and_ignore_a_double_tap() {
        let mut s = State::default();
        s.apply(StopwatchOp::Lap, 500).unwrap();
        assert!(s.laps.is_empty(), "nothing has run yet");
        s.apply(StopwatchOp::Start, 1_000).unwrap();
        s.apply(StopwatchOp::Lap, 3_000).unwrap();
        s.apply(StopwatchOp::Lap, 3_000).unwrap();
        s.apply(StopwatchOp::Lap, 7_000).unwrap();
        assert_eq!(s.laps, [2_000, 6_000]);
    }

    #[test]
    fn the_lap_list_is_capped_with_a_reason() {
        let mut s = State::default();
        s.apply(StopwatchOp::Start, 0).unwrap();
        for i in 1..=MAX_LAPS as i64 {
            s.apply(StopwatchOp::Lap, i * 1_000).unwrap();
        }
        let err = s.apply(StopwatchOp::Lap, (MAX_LAPS as i64 + 1) * 1_000).unwrap_err();
        assert!(err.contains("200 laps"), "{err}");
        assert_eq!(s.laps.len(), MAX_LAPS);
    }

    #[test]
    fn reset_clears_everything_and_a_clock_set_back_never_runs_negative() {
        let mut s = State::default();
        s.apply(StopwatchOp::Start, 10_000).unwrap();
        assert_eq!(s.elapsed(9_000), 0, "the system clock moved back");
        s.apply(StopwatchOp::Lap, 12_000).unwrap();
        s.apply(StopwatchOp::Reset, 13_000).unwrap();
        assert_eq!(s, State::default());
    }

    #[test]
    fn the_view_follows_the_ui_shape() {
        let mut s = State::default();
        s.apply(StopwatchOp::Start, 1_000).unwrap();
        s.apply(StopwatchOp::Lap, 2_500).unwrap();
        assert_eq!(
            serde_json::to_value(s.view()).unwrap(),
            serde_json::json!({ "running": true, "startedAt": 1000, "bankedMs": 0, "laps": [1500] })
        );
        s.apply(StopwatchOp::Pause, 4_000).unwrap();
        assert_eq!(
            serde_json::to_value(s.view()).unwrap(),
            serde_json::json!({ "running": false, "startedAt": null, "bankedMs": 3000, "laps": [1500] })
        );
    }

    #[test]
    fn a_running_stopwatch_survives_a_restart_and_changes_are_reported() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("stopwatch.json");
        let (first, events) = stopwatch(file.clone());
        first.command(StopwatchOp::Start, 1_000).unwrap();
        first.command(StopwatchOp::Lap, 3_000).unwrap();
        assert_eq!(events.try_iter().count(), 2, "one report per change");
        first.command(StopwatchOp::Start, 4_000).unwrap();
        assert_eq!(events.try_iter().count(), 0, "starting a running stopwatch changes nothing");
        drop(first);
        let (again, _) = stopwatch(file);
        let view = again.view();
        assert!(view.running);
        assert_eq!((view.started_at, view.laps), (Some(1_000), vec![2_000]));
    }

    #[test]
    fn a_stopwatch_that_cannot_be_saved_does_not_change() {
        let dir = tempfile::tempdir().unwrap();
        // A folder where the file should be makes the save fail.
        let file = dir.path().join("stopwatch.json");
        std::fs::create_dir(&file).unwrap();
        let (s, events) = stopwatch(file);
        let err = s.command(StopwatchOp::Start, 1_000).unwrap_err();
        assert!(err.starts_with("The stopwatch could not be saved"), "{err}");
        assert!(!s.view().running);
        assert_eq!(events.try_iter().count(), 0);
    }

    #[test]
    fn a_damaged_file_starts_a_fresh_stopwatch() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("stopwatch.json");
        std::fs::write(&file, b"{ broken").unwrap();
        let (s, _) = stopwatch(file);
        assert_eq!(s.view(), StopwatchView { running: false, started_at: None, banked_ms: 0, laps: vec![] });
    }
}

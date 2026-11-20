//! Drinking water: today's log and the time of the next reminder. The core owns both, so every dock window agrees
//! and a restart loses nothing. Everything is in the user's local time.
//!
//! Reminders happen between `START_HOUR` and `END_HOUR`, one `INTERVAL_MINUTES` after the last glass, never after the
//! goal is reached, and not before a snooze has run out. The core only says when the next one is due: the UI shows it.
//! A worker runs while the tile is on the dock, for one thing, which is to start a new day at midnight.

use crate::clock::now_ms;
use crate::com::{Refresh, Worker};
use crate::emit::lock;
use crate::paths;
use crate::wire::{Feed, HydrationOp, HydrationView, Issue};
use crate::zone::Zone;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const GOAL_ML: u32 = 2_000;
pub const GLASS_ML: u32 = 250;
pub const INTERVAL_MINUTES: u32 = 60;
/// Reminders start at this local hour (inclusive) and stop at `END_HOUR` (exclusive).
pub const START_HOUR: u32 = 8;
pub const END_HOUR: u32 = 22;
/// The most one entry may add: a big bottle, not a typo.
pub const MAX_LOG_ML: u32 = 2_000;
/// The longest a reminder may be snoozed: a day.
pub const MAX_SNOOZE_MINUTES: u32 = 24 * 60;
const MS_PER_MINUTE: i64 = 60_000;
/// The worker looks at the clock at least this often, so a clock change cannot leave a stale day for long.
const LOOK_AT_LEAST_EVERY: Duration = Duration::from_secs(60 * 60);
/// Midnight plus this, so the wake-up falls on the new day.
const AFTER_MIDNIGHT: Duration = Duration::from_millis(500);

#[derive(Serialize, Deserialize, Default, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase", default)]
struct State {
    /// Local calendar day (days since 1970-01-01) the log belongs to; a new day starts an empty log.
    day: i64,
    logged_ml: u32,
    /// When the last glass was logged.
    last_logged_at: Option<i64>,
    /// The reminder stays quiet until this time.
    snoozed_until: Option<i64>,
}

/// The reminder window of the day `now` is in, and the start of the next one.
struct Window {
    opens: i64,
    closes: i64,
    tomorrow: i64,
}

fn window(now: i64, zone: &dyn Zone) -> Option<Window> {
    Some(Window {
        opens: zone.at(now, 0, START_HOUR)?,
        closes: zone.at(now, 0, END_HOUR)?,
        tomorrow: zone.at(now, 1, START_HOUR)?,
    })
}

/// How long until the day after the one `now` is in begins, plus a moment so the wake-up falls on the new day.
/// When the zone cannot say, the worker just looks again at its normal interval.
fn until_midnight(now: i64, zone: &dyn Zone) -> Duration {
    zone.at(now, 1, 0)
        .and_then(|midnight| u64::try_from(midnight - now).ok())
        .map_or(LOOK_AT_LEAST_EVERY, |ms| Duration::from_millis(ms) + AFTER_MIDNIGHT)
}

impl State {
    /// The log as of `now`: the same, or an empty one when the day has changed.
    fn on_day_of(&self, now: i64, zone: &dyn Zone) -> Option<State> {
        let day = zone.day(now)?;
        Some(if self.day == day { self.clone() } else { State { day, ..State::default() } })
    }

    /// When the next reminder is due. A time in the past means it is due now.
    fn next_reminder(&self, now: i64, w: &Window) -> i64 {
        if self.logged_ml >= GOAL_ML || now >= w.closes {
            return w.tomorrow;
        }
        let after_glass =
            self.last_logged_at.map_or(w.opens, |at| w.opens.max(at + i64::from(INTERVAL_MINUTES) * MS_PER_MINUTE));
        let due = after_glass.max(self.snoozed_until.unwrap_or(0));
        if due >= w.closes {
            w.tomorrow
        } else {
            due
        }
    }

    fn view(&self, now: i64, zone: &dyn Zone) -> Feed<HydrationView> {
        let Some(w) = window(now, zone) else { return Feed::issue(Issue::Error) };
        Feed::data(HydrationView {
            goal_ml: GOAL_ML,
            logged_ml: self.logged_ml,
            glass_ml: GLASS_ML,
            next_reminder_at: Some(self.next_reminder(now, &w)),
            interval_minutes: INTERVAL_MINUTES,
        })
    }

    fn apply(&mut self, op: HydrationOp, now: i64) -> Result<(), String> {
        match op {
            HydrationOp::Log { ml } => {
                if !(1..=MAX_LOG_ML).contains(&ml) {
                    return Err(format!("Log between 1 and {MAX_LOG_ML} ml at a time"));
                }
                self.logged_ml = self.logged_ml.saturating_add(ml);
                self.last_logged_at = Some(now);
                self.snoozed_until = None;
            }
            HydrationOp::Snooze { minutes } => {
                if !(1..=MAX_SNOOZE_MINUTES).contains(&minutes) {
                    return Err(format!("Snooze for between 1 minute and {MAX_SNOOZE_MINUTES} minutes"));
                }
                self.snoozed_until = Some(now + i64::from(minutes) * MS_PER_MINUTE);
            }
        }
        Ok(())
    }
}

pub struct Hydration {
    file: PathBuf,
    zone: Arc<dyn Zone>,
    state: Arc<Mutex<State>>,
    changed: Arc<dyn Fn(Feed<HydrationView>) + Send + Sync>,
    worker: Mutex<Option<Worker<Refresh>>>,
}

impl Hydration {
    /// `changed` is called with the new feed after every command and when a new day starts.
    pub fn new(
        file: PathBuf,
        zone: Arc<dyn Zone>,
        changed: impl Fn(Feed<HydrationView>) + Send + Sync + 'static,
    ) -> Self {
        let state = paths::read_json::<State>(&file).unwrap_or_default();
        Self { file, zone, state: Arc::new(Mutex::new(state)), changed: Arc::new(changed), worker: Mutex::new(None) }
    }

    pub fn view(&self, now: i64) -> Feed<HydrationView> {
        match lock(&self.state).on_day_of(now, &*self.zone) {
            Some(today) => today.view(now, &*self.zone),
            None => Feed::issue(Issue::Error),
        }
    }

    /// Applies a command at `now`, saves the result, and reports it. Nothing changes if it cannot be saved.
    pub fn command(&self, op: HydrationOp, now: i64) -> Result<(), String> {
        let mut state = lock(&self.state);
        let mut next = state.on_day_of(now, &*self.zone).ok_or("Windows would not give the local time")?;
        next.apply(op, now)?;
        paths::write_json(&self.file, &next).map_err(|e| format!("The water log could not be saved: {e}"))?;
        *state = next;
        let feed = state.view(now, &*self.zone);
        drop(state);
        (self.changed)(feed);
        Ok(())
    }

    /// Starts the worker that begins a new day at midnight. Call while the tile is on the dock.
    pub fn start(&self) -> Result<(), String> {
        let mut slot = lock(&self.worker);
        if slot.is_some() {
            return Ok(());
        }
        let (zone, changed, state) = (self.zone.clone(), self.changed.clone(), self.state.clone());
        let worker = Worker::spawn("tiles-hydration", move |rx, _tx| {
            let mut day = zone.day(now_ms());
            loop {
                let wait = until_midnight(now_ms(), &*zone).min(LOOK_AT_LEAST_EVERY);
                if !matches!(rx.recv_timeout(wait), Err(std::sync::mpsc::RecvTimeoutError::Timeout)) {
                    break;
                }
                let now = now_ms();
                let today = zone.day(now);
                if today != day {
                    day = today;
                    let feed = match lock(&state).on_day_of(now, &*zone) {
                        Some(fresh) => fresh.view(now, &*zone),
                        None => Feed::issue(Issue::Error),
                    };
                    (changed)(feed);
                }
            }
        })
        .map_err(|e| format!("could not start the water reminder: {e}"))?;
        *slot = Some(worker);
        Ok(())
    }

    pub fn stop(&self) {
        let worker = lock(&self.worker).take();
        drop(worker);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::zone::Local;
    use std::sync::mpsc::channel;

    const MS_PER_HOUR: i64 = 3_600_000;
    const MS_PER_DAY: i64 = 24 * MS_PER_HOUR;
    /// 2026-11-20 as days since 1970-01-01.
    const TODAY: i64 = 20_777;

    /// A zone that is a fixed number of hours ahead of UTC, so day boundaries can be placed exactly.
    struct Fixed(i64);

    impl Zone for Fixed {
        fn day(&self, now: i64) -> Option<i64> {
            Some((now + self.0 * MS_PER_HOUR).div_euclid(MS_PER_DAY))
        }

        fn at(&self, now: i64, days: i64, hour: u32) -> Option<i64> {
            Some((self.day(now)? + days) * MS_PER_DAY + i64::from(hour) * MS_PER_HOUR - self.0 * MS_PER_HOUR)
        }
    }

    struct Broken;

    impl Zone for Broken {
        fn day(&self, _: i64) -> Option<i64> {
            None
        }

        fn at(&self, _: i64, _: i64, _: u32) -> Option<i64> {
            None
        }
    }

    const ZONE: Fixed = Fixed(5);

    /// Local time `hour:minute` on the day `day_offset` after TODAY, in the test zone, as a Unix time.
    fn local(day_offset: i64, hour: i64, minute: i64) -> i64 {
        (TODAY + day_offset) * MS_PER_DAY + hour * MS_PER_HOUR + minute * MS_PER_MINUTE - 5 * MS_PER_HOUR
    }

    fn fresh() -> State {
        State { day: TODAY, ..State::default() }
    }

    fn next(state: &State, now: i64) -> i64 {
        state.next_reminder(now, &window(now, &ZONE).unwrap())
    }

    #[test]
    fn before_the_window_and_with_no_glass_the_reminder_waits_for_the_morning() {
        assert_eq!(next(&fresh(), local(0, 7, 0)), local(0, START_HOUR.into(), 0));
        assert_eq!(next(&fresh(), local(0, 10, 0)), local(0, START_HOUR.into(), 0), "past, so it is due now");
    }

    #[test]
    fn a_glass_postpones_the_next_reminder_by_one_interval() {
        let mut s = fresh();
        s.apply(HydrationOp::Log { ml: 250 }, local(0, 10, 0)).unwrap();
        assert_eq!((s.logged_ml, s.last_logged_at), (250, Some(local(0, 10, 0))));
        assert_eq!(next(&s, local(0, 10, 5)), local(0, 11, 0));
    }

    #[test]
    fn a_snooze_pushes_it_back_and_the_next_glass_cancels_the_snooze() {
        let mut s = fresh();
        s.apply(HydrationOp::Log { ml: 250 }, local(0, 10, 0)).unwrap();
        s.apply(HydrationOp::Snooze { minutes: 45 }, local(0, 11, 0)).unwrap();
        assert_eq!(next(&s, local(0, 11, 1)), local(0, 11, 45));
        s.apply(HydrationOp::Log { ml: 250 }, local(0, 11, 10)).unwrap();
        assert_eq!(s.snoozed_until, None);
        assert_eq!(next(&s, local(0, 11, 11)), local(0, 12, 10));
    }

    #[test]
    fn a_snooze_shorter_than_the_interval_does_not_bring_the_reminder_forward() {
        let mut s = fresh();
        s.apply(HydrationOp::Log { ml: 250 }, local(0, 10, 0)).unwrap();
        s.apply(HydrationOp::Snooze { minutes: 5 }, local(0, 10, 1)).unwrap();
        assert_eq!(next(&s, local(0, 10, 2)), local(0, 11, 0));
    }

    #[test]
    fn once_the_goal_is_reached_or_the_window_has_closed_the_next_reminder_is_tomorrow() {
        let mut s = fresh();
        for _ in 0..(GOAL_ML / GLASS_ML) {
            s.apply(HydrationOp::Log { ml: GLASS_ML }, local(0, 9, 0)).unwrap();
        }
        assert_eq!(next(&s, local(0, 9, 1)), local(1, START_HOUR.into(), 0), "the goal is met");
        assert_eq!(next(&fresh(), local(0, 22, 30)), local(1, START_HOUR.into(), 0), "the window has closed");
        let mut late = fresh();
        late.apply(HydrationOp::Log { ml: 250 }, local(0, 21, 30)).unwrap();
        assert_eq!(
            next(&late, local(0, 21, 31)),
            local(1, START_HOUR.into(), 0),
            "the next one would fall after it closes"
        );
    }

    #[test]
    fn a_new_day_starts_an_empty_log() {
        let mut yesterday = State { day: TODAY - 1, ..State::default() };
        yesterday.apply(HydrationOp::Log { ml: 500 }, local(-1, 20, 0)).unwrap();
        yesterday.apply(HydrationOp::Snooze { minutes: 30 }, local(-1, 21, 0)).unwrap();
        assert_eq!(yesterday.on_day_of(local(0, 7, 0), &ZONE), Some(fresh()));
        assert_eq!(yesterday.on_day_of(local(-1, 23, 0), &ZONE), Some(yesterday.clone()), "still the same day");
        assert_eq!(yesterday.on_day_of(local(0, 7, 0), &Broken), None);
    }

    #[test]
    fn the_midnight_is_found_in_the_users_zone() {
        assert_eq!(until_midnight(local(0, 23, 30), &ZONE), Duration::from_secs(30 * 60) + AFTER_MIDNIGHT);
        assert_eq!(until_midnight(local(0, 0, 0), &ZONE), Duration::from_secs(24 * 60 * 60) + AFTER_MIDNIGHT);
        assert_eq!(until_midnight(local(0, 12, 0), &Broken), LOOK_AT_LEAST_EVERY);
    }

    #[test]
    fn entries_outside_the_limits_are_refused_with_a_reason() {
        let mut s = fresh();
        for ml in [0, MAX_LOG_ML + 1] {
            assert!(s.apply(HydrationOp::Log { ml }, 0).unwrap_err().contains("Log between"), "{ml}");
        }
        for minutes in [0, MAX_SNOOZE_MINUTES + 1] {
            assert!(s.apply(HydrationOp::Snooze { minutes }, 0).unwrap_err().contains("Snooze for"), "{minutes}");
        }
        assert_eq!(s, fresh(), "a refused entry changes nothing");
    }

    #[test]
    fn the_view_follows_the_ui_shape_and_a_broken_clock_is_an_error() {
        let mut s = fresh();
        s.apply(HydrationOp::Log { ml: 250 }, local(0, 10, 0)).unwrap();
        let feed = s.view(local(0, 10, 1), &ZONE);
        assert_eq!(
            serde_json::to_value(feed).unwrap(),
            serde_json::json!({
                "data": {
                    "goalMl": 2000, "loggedMl": 250, "glassMl": 250,
                    "nextReminderAt": local(0, 11, 0), "intervalMinutes": 60
                },
                "issue": null
            })
        );
        assert_eq!(s.view(0, &Broken), Feed::issue(Issue::Error));
    }

    #[test]
    fn the_log_is_saved_reported_and_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("hydration.json");
        let (tx, rx) = channel();
        let h = Hydration::new(file.clone(), Arc::new(ZONE), move |f| drop(tx.send(f)));
        let now = local(0, 10, 0);
        h.command(HydrationOp::Log { ml: 250 }, now).unwrap();
        h.command(HydrationOp::Log { ml: 500 }, now + 1).unwrap();
        assert_eq!(rx.try_iter().count(), 2, "one report per command");
        drop(h);
        let again = Hydration::new(file, Arc::new(ZONE), |_| {});
        assert_eq!(again.view(now + 2).data.map(|v| v.logged_ml), Some(750));
        assert_eq!(again.view(local(1, 8, 0)).data.map(|v| v.logged_ml), Some(0), "tomorrow starts empty");
    }

    #[test]
    fn a_log_that_cannot_be_saved_is_refused_and_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("hydration.json");
        std::fs::create_dir(&file).unwrap();
        let (tx, rx) = channel();
        let h = Hydration::new(file, Arc::new(ZONE), move |f| drop(tx.send(f)));
        let now = local(0, 10, 0);
        let err = h.command(HydrationOp::Log { ml: 250 }, now).unwrap_err();
        assert!(err.starts_with("The water log could not be saved"), "{err}");
        assert_eq!(h.view(now).data.map(|v| v.logged_ml), Some(0));
        assert_eq!(rx.try_iter().count(), 0);
    }

    #[test]
    fn the_midnight_worker_starts_once_and_stops_cleanly() {
        let dir = tempfile::tempdir().unwrap();
        let h = Hydration::new(dir.path().join("hydration.json"), Arc::new(Local), |_| {});
        h.start().unwrap();
        h.start().unwrap();
        h.stop();
        h.stop();
    }
}

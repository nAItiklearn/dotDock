//! One signal that a module's worker threads sleep on, so stopping the module wakes them at once.
//!
//! A worker never uses `thread::sleep` for a pause that must end when its module is switched off:
//! it calls [`RunGate::pause`], which returns early, and false, the moment the gate is stopped.
//! Three things can happen to a gate, all from any thread:
//! - `open`: the module's window reports that it is listening, so workers may start pushing data;
//! - `nudge`: a worker that waits for work is asked to look again now;
//! - `stop`: every waiter wakes and every later wait returns at once.

use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

#[derive(Default)]
struct Flags {
    open: bool,
    stopped: bool,
    nudged: bool,
}

/// Why [`RunGate::wait_nudge`] returned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wait {
    Stopped,
    Nudged,
    TimedOut,
}

#[derive(Clone, Default)]
pub struct RunGate(Arc<(Mutex<Flags>, Condvar)>);

impl RunGate {
    fn flags(&self) -> MutexGuard<'_, Flags> {
        self.0 .0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn change(&self, update: impl FnOnce(&mut Flags)) {
        update(&mut self.flags());
        self.0 .1.notify_all();
    }

    pub fn open(&self) {
        self.change(|f| f.open = true);
    }

    pub fn nudge(&self) {
        self.change(|f| f.nudged = true);
    }

    pub fn stop(&self) {
        self.change(|f| f.stopped = true);
    }

    pub fn is_stopped(&self) -> bool {
        self.flags().stopped
    }

    /// Blocks until the gate is opened. False if it was stopped first.
    pub fn wait_open(&self) -> bool {
        let mut flags = self.flags();
        while !flags.open && !flags.stopped {
            flags = self.0 .1.wait(flags).unwrap_or_else(PoisonError::into_inner);
        }
        !flags.stopped
    }

    /// Sleeps for `duration`. False if the gate was stopped, which ends the sleep early.
    pub fn pause(&self, duration: Duration) -> bool {
        let deadline = Instant::now() + duration;
        let mut flags = self.flags();
        while !flags.stopped {
            let Some(left) = deadline.checked_duration_since(Instant::now()).filter(|d| !d.is_zero()) else { break };
            flags = self.0 .1.wait_timeout(flags, left).unwrap_or_else(PoisonError::into_inner).0;
        }
        !flags.stopped
    }

    /// Waits for a nudge, a stop, or `timeout` (forever when None). A nudge is consumed.
    pub fn wait_nudge(&self, timeout: Option<Duration>) -> Wait {
        let deadline = timeout.map(|t| Instant::now() + t);
        let mut flags = self.flags();
        loop {
            if flags.stopped {
                return Wait::Stopped;
            }
            if flags.nudged {
                flags.nudged = false;
                return Wait::Nudged;
            }
            flags = match deadline {
                None => self.0 .1.wait(flags).unwrap_or_else(PoisonError::into_inner),
                Some(deadline) => {
                    let Some(left) = deadline.checked_duration_since(Instant::now()).filter(|d| !d.is_zero()) else {
                        return Wait::TimedOut;
                    };
                    self.0 .1.wait_timeout(flags, left).unwrap_or_else(PoisonError::into_inner).0
                }
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    const SLEEP_FOR: Duration = Duration::from_secs(30);
    const PROMPT: Duration = Duration::from_secs(5);

    #[test]
    fn a_pause_runs_its_course_when_nothing_stops_it() {
        let gate = RunGate::default();
        let started = Instant::now();
        assert!(gate.pause(Duration::from_millis(30)));
        assert!(started.elapsed() >= Duration::from_millis(30));
    }

    #[test]
    fn stopping_ends_a_long_pause_at_once() {
        let gate = RunGate::default();
        let sleeper = gate.clone();
        let worker = thread::spawn(move || {
            let started = Instant::now();
            (sleeper.pause(SLEEP_FOR), started.elapsed())
        });
        thread::sleep(Duration::from_millis(20));
        gate.stop();
        let (kept_going, took) = worker.join().expect("worker");
        assert!(!kept_going);
        assert!(took < PROMPT, "the pause lasted {took:?}");
    }

    #[test]
    fn every_wait_after_a_stop_returns_immediately() {
        let gate = RunGate::default();
        gate.stop();
        assert!(gate.is_stopped());
        assert!(!gate.pause(SLEEP_FOR));
        assert!(!gate.wait_open());
        assert_eq!(gate.wait_nudge(None), Wait::Stopped);
    }

    #[test]
    fn workers_wait_for_the_window_to_open_the_gate() {
        let gate = RunGate::default();
        let waiter = gate.clone();
        let worker = thread::spawn(move || waiter.wait_open());
        thread::sleep(Duration::from_millis(20));
        assert!(!worker.is_finished());
        gate.open();
        assert!(worker.join().expect("worker"));
    }

    #[test]
    fn stopping_releases_workers_that_never_saw_the_gate_open() {
        let gate = RunGate::default();
        let waiter = gate.clone();
        let worker = thread::spawn(move || waiter.wait_open());
        thread::sleep(Duration::from_millis(20));
        gate.stop();
        assert!(!worker.join().expect("worker"));
    }

    #[test]
    fn a_nudge_is_consumed_by_exactly_one_wait() {
        let gate = RunGate::default();
        gate.nudge();
        assert_eq!(gate.wait_nudge(Some(Duration::from_millis(10))), Wait::Nudged);
        assert_eq!(gate.wait_nudge(Some(Duration::from_millis(10))), Wait::TimedOut);
    }

    #[test]
    fn a_nudge_sent_while_waiting_wakes_the_waiter() {
        let gate = RunGate::default();
        let waiter = gate.clone();
        let worker = thread::spawn(move || waiter.wait_nudge(None));
        thread::sleep(Duration::from_millis(20));
        gate.nudge();
        assert_eq!(worker.join().expect("worker"), Wait::Nudged);
    }

    #[test]
    fn stopping_wins_over_a_pending_nudge() {
        let gate = RunGate::default();
        gate.nudge();
        gate.stop();
        assert_eq!(gate.wait_nudge(Some(PROMPT)), Wait::Stopped);
    }
}

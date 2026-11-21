//! Hides and restores the Windows taskbar on a thread of its own: both can block for a second or more (Explorer
//! applies an auto-hide change about half a second after it is asked), and the dock must keep drawing meanwhile.
//!
//! What hiding and restoring mean, and how the way back is guaranteed, is the host application's business
//! (`dock_guard` in the shell crate); the worker only decides *when* to call them and in what order.

use std::io;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

/// Hides (`true`) or restores (`false`) the taskbar. `Err` means it was refused and nothing was changed.
pub type Apply = Arc<dyn Fn(bool) -> Result<(), String> + Send + Sync>;

/// What the worker tells its owner after a change.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// The taskbar is now hidden (`true`) or shown (`false`).
    Applied(bool),
    /// Hiding was refused; the taskbar is as it was and is not wanted hidden any more.
    Refused(String),
}

enum Message {
    Want(bool),
    /// Explorer restarted and built a new taskbar: hide it again if it is wanted hidden.
    Rehide,
    Stop,
}

/// The state machine behind the thread, without the thread.
struct Machine {
    wanted: bool,
    /// Whether the taskbar has been hidden by us. A fresh machine has hidden nothing.
    hidden: bool,
}

impl Machine {
    /// What to do after learning the new wish: `Some(true)` hide, `Some(false)` restore, `None` nothing.
    fn want(&mut self, hidden: bool) -> Option<bool> {
        self.wanted = hidden;
        (self.hidden != hidden).then_some(hidden)
    }

    fn rehide(&self) -> Option<bool> {
        self.wanted.then_some(true)
    }

    fn applied(&mut self, hidden: bool) {
        self.hidden = hidden;
    }

    fn refused(&mut self) {
        self.wanted = false;
    }
}

pub struct Replacement {
    tx: Sender<Message>,
    thread: Option<JoinHandle<()>>,
}

impl Replacement {
    /// Starts the worker. `done` is called on the worker thread after each change.
    pub fn start(apply: Apply, done: impl Fn(Outcome) + Send + 'static) -> io::Result<Replacement> {
        let (tx, rx) = channel();
        let thread = thread::Builder::new().name("dock-taskbar".into()).spawn(move || run(&rx, &apply, &done))?;
        Ok(Replacement { tx, thread: Some(thread) })
    }

    /// The taskbar should be hidden (`true`) or shown (`false`). Asking for what already is does nothing.
    pub fn want(&self, hidden: bool) {
        let _ = self.tx.send(Message::Want(hidden));
    }

    pub fn rehide(&self) {
        let _ = self.tx.send(Message::Rehide);
    }
}

impl Drop for Replacement {
    fn drop(&mut self) {
        let _ = self.tx.send(Message::Stop);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn run(rx: &Receiver<Message>, apply: &Apply, done: &dyn Fn(Outcome)) {
    let mut machine = Machine { wanted: false, hidden: false };
    // In order, one at a time: the machine drops the wishes that ask for what already is.
    while let Ok(message) = rx.recv() {
        let action = match message {
            Message::Stop => return,
            Message::Want(hidden) => machine.want(hidden),
            Message::Rehide => machine.rehide(),
        };
        let Some(hide) = action else { continue };
        match apply(hide) {
            Ok(()) => {
                machine.applied(hide);
                done(Outcome::Applied(hide));
            }
            Err(reason) => {
                machine.refused();
                done(Outcome::Refused(reason));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    #[test]
    fn it_does_nothing_for_what_already_is() {
        let mut machine = Machine { wanted: false, hidden: false };
        assert_eq!(machine.want(false), None, "a fresh machine has nothing to restore");
        assert_eq!(machine.want(true), Some(true));
        machine.applied(true);
        assert_eq!(machine.want(true), None);
        assert_eq!(machine.want(false), Some(false));
    }

    #[test]
    fn a_restarted_explorer_gets_a_new_hide_only_when_one_is_wanted() {
        let mut machine = Machine { wanted: false, hidden: false };
        assert_eq!(machine.rehide(), None);
        machine.want(true);
        machine.applied(true);
        assert_eq!(machine.rehide(), Some(true));
    }

    #[test]
    fn a_refusal_stops_wanting_it() {
        let mut machine = Machine { wanted: false, hidden: false };
        machine.want(true);
        machine.refused();
        assert_eq!(machine.rehide(), None);
        assert!(!machine.hidden);
    }

    fn wait_for(condition: impl Fn() -> bool) -> bool {
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if condition() {
                return true;
            }
            thread::sleep(Duration::from_millis(5));
        }
        false
    }

    #[test]
    fn the_worker_hides_then_restores_and_reports_each_change() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&calls);
        let apply: Apply = Arc::new(move |hide| {
            log.lock().unwrap().push(hide);
            Ok(())
        });
        let outcomes = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&outcomes);
        let worker = Replacement::start(apply, move |o| sink.lock().unwrap().push(o)).expect("worker");
        worker.want(false);
        worker.want(true);
        worker.want(true);
        assert!(wait_for(|| outcomes.lock().unwrap().len() == 1));
        worker.rehide();
        assert!(wait_for(|| outcomes.lock().unwrap().len() == 2));
        worker.want(false);
        assert!(wait_for(|| outcomes.lock().unwrap().len() == 3));
        drop(worker);
        assert_eq!(*calls.lock().unwrap(), vec![true, true, false]);
        assert_eq!(
            *outcomes.lock().unwrap(),
            vec![Outcome::Applied(true), Outcome::Applied(true), Outcome::Applied(false)]
        );
    }

    #[test]
    fn a_refusal_is_reported_and_not_retried() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&attempts);
        let apply: Apply = Arc::new(move |_| {
            counter.fetch_add(1, Ordering::SeqCst);
            Err("no snapshot".to_owned())
        });
        let outcomes = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&outcomes);
        let worker = Replacement::start(apply, move |o| sink.lock().unwrap().push(o)).expect("worker");
        worker.want(true);
        assert!(wait_for(|| outcomes.lock().unwrap().len() == 1));
        worker.rehide();
        thread::sleep(Duration::from_millis(50));
        drop(worker);
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
        assert_eq!(*outcomes.lock().unwrap(), vec![Outcome::Refused("no snapshot".into())]);
    }
}

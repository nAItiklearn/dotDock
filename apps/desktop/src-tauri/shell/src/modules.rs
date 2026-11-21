//! The parts of dotDock that run together as one environment: the home screen, the dock, the taskbar
//! replacement and the notch (Agent Island).
//!
//! Each part plugs in as a [`Lifecycle`]: `start` brings it up, `stop` takes it down completely, with
//! no window, thread or changed Windows setting left behind. [`Modules`] runs the parts as a unit and
//! owns the only two choices the user has, both saved in `modules.json` and applied at once:
//! - the environment as a whole, on or off. Off stops every part and leaves plain Windows;
//! - whether the Windows taskbar stays. When it does, the taskbar replacement is not started and the
//!   dock keeps running.
//!
//! Rules the manager enforces so no lifecycle has to:
//! - a lifecycle is started only while stopped and stopped only while running;
//! - the taskbar replacement needs the dock running: it starts after it and stops before it;
//! - whenever the taskbar replacement stops, or fails to start, the real taskbar is put back by
//!   `restore_taskbar` as well, whatever the lifecycle itself did;
//! - a part with no lifecycle (not in this build) is skipped, and the Windows taskbar then stays.
//!
//! The manager is deliberately free of any UI framework, so all of this is unit-tested.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

/// Name of the file holding the user's choices, inside the app data folder.
pub const FILE: &str = "modules.json";
const SCHEMA: u32 = 1;

/// Dependencies come before their dependents, so this order is the start order and its reverse the stop order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum ModuleId {
    Home,
    Dock,
    Taskbar,
    Notch,
}

impl ModuleId {
    pub const ALL: [Self; 4] = [Self::Home, Self::Dock, Self::Taskbar, Self::Notch];

    /// How the part is named in a sentence.
    pub const fn label(self) -> &'static str {
        match self {
            Self::Home => "home screen",
            Self::Dock => "dock",
            Self::Taskbar => "taskbar replacement",
            Self::Notch => "notch",
        }
    }

    /// The part that has to be running for this one to make sense.
    pub const fn requires(self) -> Option<Self> {
        match self {
            Self::Taskbar => Some(Self::Dock),
            Self::Home | Self::Dock | Self::Notch => None,
        }
    }
}

/// One part's way of starting and stopping. Implemented once per part, by whoever owns its windows.
pub trait Lifecycle: Send {
    /// Brings the part up. Called only while it is stopped. When it fails, nothing may be left running
    /// and no Windows setting changed; the reason is shown to the user as written.
    fn start(&mut self) -> Result<(), String>;

    /// Takes the part down completely: windows destroyed, threads joined, anything it changed in
    /// Windows put back. Called only while it is running, and must not fail.
    fn stop(&mut self);
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ModuleError {
    #[error("the {} is not part of this build", .0.label())]
    Unavailable(ModuleId),
    #[error("the {} did not start: {reason}", .module.label())]
    StartFailed { module: ModuleId, reason: String },
    #[error("the choice could not be saved: {0}")]
    Storage(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Running,
    /// Off: the environment is off, or the user keeps the Windows taskbar.
    Stopped,
    /// Meant to run, but the part it needs is not running.
    Waiting,
    /// Meant to run, and the last attempt to start it failed.
    Failed,
    /// No lifecycle is plugged in: this build does not have the part.
    Unavailable,
}

/// Where one part stands.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModuleStatus {
    pub id: ModuleId,
    pub state: State,
    /// Why the last start failed, while `state` is `Failed`.
    pub error: Option<String>,
}

/// What Settings shows: the two choices, and what did not start.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    /// The whole environment is switched on.
    pub on: bool,
    /// The Windows taskbar stays: by choice, or because this build has no replacement for it.
    pub windows_taskbar: bool,
    /// This build has a taskbar replacement the user can switch to.
    pub taskbar_replacement: bool,
    /// Parts that are meant to run and did not start, each with its reason in words.
    pub problems: Vec<String>,
}

// ---------------------------------------------------------------- choices

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Choices {
    environment: bool,
    windows_taskbar: bool,
}

impl Default for Choices {
    /// The whole environment, including its taskbar, is what dotDock is for.
    fn default() -> Self {
        Self { environment: true, windows_taskbar: false }
    }
}

const fn yes() -> bool {
    true
}

/// The file on disk. A missing field means its default, so a file from an older or newer build still loads.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    schema: u32,
    #[serde(default = "yes")]
    environment: bool,
    #[serde(default)]
    windows_taskbar: bool,
}

fn load(path: &Path) -> Choices {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Stored>(&bytes).ok())
        .map_or_else(Choices::default, |s| Choices { environment: s.environment, windows_taskbar: s.windows_taskbar })
}

/// Write-then-rename, flushed to disk, so a power cut leaves the old file or the new one, never half.
fn save(path: &Path, choices: Choices) -> std::io::Result<()> {
    let stored = Stored { schema: SCHEMA, environment: choices.environment, windows_taskbar: choices.windows_taskbar };
    let tmp = path.with_extension("json.tmp");
    let mut file = std::fs::File::create(&tmp)?;
    file.write_all(&serde_json::to_vec_pretty(&stored)?)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(tmp, path)
}

// ---------------------------------------------------------------- manager

#[derive(Default)]
struct Slot {
    lifecycle: Option<Box<dyn Lifecycle>>,
    running: bool,
    error: Option<String>,
}

struct Inner {
    path: Option<PathBuf>,
    choices: Choices,
    slots: BTreeMap<ModuleId, Slot>,
}

type Restore = Box<dyn Fn() + Send + Sync>;
type Listener = Box<dyn Fn(&[ModuleStatus]) + Send + Sync>;

/// The first letter in capitals, for a sentence that starts with a part's name.
fn capitalised(text: &str) -> String {
    let mut chars = text.chars();
    chars.next().map_or_else(String::new, |first| first.to_uppercase().chain(chars).collect())
}

impl Inner {
    fn slot(&mut self, id: ModuleId) -> &mut Slot {
        self.slots.entry(id).or_default()
    }

    fn is_running(&self, id: ModuleId) -> bool {
        self.slots.get(&id).is_some_and(|s| s.running)
    }

    fn is_available(&self, id: ModuleId) -> bool {
        self.slots.get(&id).is_some_and(|s| s.lifecycle.is_some())
    }

    /// Whether the user's choices call for this part, before asking whether what it needs is up. "Use the
    /// Windows taskbar" gives Windows its own bar back: the dock and its taking the taskbar's place both stop.
    fn wanted(&self, id: ModuleId) -> bool {
        match id {
            ModuleId::Dock | ModuleId::Taskbar => self.choices.environment && !self.choices.windows_taskbar,
            ModuleId::Home | ModuleId::Notch => self.choices.environment,
        }
    }

    fn requirement_met(&self, id: ModuleId) -> bool {
        id.requires().is_none_or(|needs| self.is_running(needs))
    }

    fn status(&self, id: ModuleId) -> ModuleStatus {
        let error = self.slots.get(&id).and_then(|s| s.error.clone());
        let state = if !self.is_available(id) {
            State::Unavailable
        } else if self.is_running(id) {
            State::Running
        } else if error.is_some() {
            State::Failed
        } else if self.wanted(id) {
            State::Waiting
        } else {
            State::Stopped
        };
        ModuleStatus { id, state, error }
    }

    fn statuses(&self) -> Vec<ModuleStatus> {
        ModuleId::ALL.iter().map(|id| self.status(*id)).collect()
    }

    fn environment(&self) -> Environment {
        let taskbar_replacement = self.is_available(ModuleId::Taskbar);
        let problems = self
            .statuses()
            .into_iter()
            .filter_map(|s| s.error.map(|reason| format!("{}: {reason}", capitalised(s.id.label()))))
            .collect();
        Environment {
            on: self.choices.environment,
            windows_taskbar: self.choices.windows_taskbar || !taskbar_replacement,
            taskbar_replacement,
            problems,
        }
    }

    fn persist(&self) -> Result<(), ModuleError> {
        match &self.path {
            Some(path) => save(path, self.choices).map_err(|e| ModuleError::Storage(e.to_string())),
            None => Ok(()),
        }
    }

    fn stop_one(&mut self, id: ModuleId, restore: &Restore) {
        let slot = self.slot(id);
        if slot.running {
            if let Some(lifecycle) = slot.lifecycle.as_mut() {
                lifecycle.stop();
            }
        }
        slot.running = false;
        if id == ModuleId::Taskbar {
            restore();
        }
    }

    fn start_one(&mut self, id: ModuleId, restore: &Restore) {
        let slot = self.slot(id);
        let Some(lifecycle) = slot.lifecycle.as_mut() else { return };
        match lifecycle.start() {
            Ok(()) => {
                slot.running = true;
                slot.error = None;
            }
            Err(reason) => {
                slot.error = Some(reason);
                // A start that failed half way may already have hidden the taskbar.
                if id == ModuleId::Taskbar {
                    restore();
                }
            }
        }
    }

    /// Brings what is running in line with the choices: first stops what should not run (dependents
    /// before the parts they need), then starts what should (needs first). A part whose last start
    /// failed is not tried again until something clears its error.
    fn reconcile(&mut self, restore: &Restore) {
        for id in ModuleId::ALL.into_iter().rev() {
            if self.is_running(id) && !(self.wanted(id) && self.requirement_met(id)) {
                self.stop_one(id, restore);
            }
        }
        for id in ModuleId::ALL {
            let untried = self.slots.get(&id).is_some_and(|s| s.lifecycle.is_some() && s.error.is_none());
            if untried && !self.is_running(id) && self.wanted(id) && self.requirement_met(id) {
                self.start_one(id, restore);
            }
        }
    }

    /// Saves `choices`, or leaves everything as it was when that fails.
    fn adopt(&mut self, choices: Choices) -> Result<(), ModuleError> {
        let previous = std::mem::replace(&mut self.choices, choices);
        self.persist().inspect_err(|_| self.choices = previous)
    }

    fn set_environment(&mut self, on: bool, restore: &Restore) -> Result<(), ModuleError> {
        if self.choices.environment == on {
            return Ok(());
        }
        self.adopt(Choices { environment: on, ..self.choices })?;
        // Switching is a fresh attempt for every part; a failure from before no longer applies.
        self.slots.values_mut().for_each(|s| s.error = None);
        self.reconcile(restore);
        Ok(())
    }

    fn set_windows_taskbar(&mut self, use_windows: bool, restore: &Restore) -> Result<(), ModuleError> {
        if !use_windows && !self.is_available(ModuleId::Taskbar) {
            return Err(ModuleError::Unavailable(ModuleId::Taskbar));
        }
        if self.choices.windows_taskbar == use_windows {
            return Ok(());
        }
        let previous = self.choices;
        self.adopt(Choices { windows_taskbar: use_windows, ..previous })?;
        self.slot(ModuleId::Taskbar).error = None;
        self.reconcile(restore);
        let failure = self.slots.get(&ModuleId::Taskbar).and_then(|s| s.error.clone());
        match failure {
            Some(reason) if !use_windows => {
                // It did not start, so the choice goes back to what it was: the switch must not claim the dock's taskbar.
                self.choices = previous;
                // Saving the old choice is best effort: the file still holds it unless this very write fails.
                let _ = self.persist();
                self.slot(ModuleId::Taskbar).error = None;
                // Back on the Windows taskbar, so the dock that started for the replacement stops again.
                self.reconcile(restore);
                Err(ModuleError::StartFailed { module: ModuleId::Taskbar, reason })
            }
            _ => Ok(()),
        }
    }
}

pub struct Modules {
    inner: Mutex<Inner>,
    restore_taskbar: Restore,
    on_change: Listener,
}

impl Modules {
    /// `dir` is the app data folder holding `modules.json`; None keeps the choices in memory only.
    /// `restore_taskbar` is run after the taskbar replacement stops, or fails to start, so the real
    /// taskbar comes back whatever the plugged-in lifecycle did. `on_change` hears every change of status.
    pub fn new(
        dir: Option<&Path>,
        restore_taskbar: impl Fn() + Send + Sync + 'static,
        on_change: impl Fn(&[ModuleStatus]) + Send + Sync + 'static,
    ) -> Self {
        let path = dir.map(|d| d.join(FILE));
        let choices = path.as_deref().map(load).unwrap_or_default();
        let slots = ModuleId::ALL.iter().map(|id| (*id, Slot::default())).collect();
        Self {
            inner: Mutex::new(Inner { path, choices, slots }),
            restore_taskbar: Box::new(restore_taskbar),
            on_change: Box::new(on_change),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Runs `change` on the state, and tells the listener afterwards, outside the lock, if any status moved.
    fn changing<T>(&self, change: impl FnOnce(&mut Inner, &Restore) -> T) -> T {
        let (outcome, before, after) = {
            let mut inner = self.lock();
            let before = inner.statuses();
            let outcome = change(&mut inner, &self.restore_taskbar);
            (outcome, before, inner.statuses())
        };
        if before != after {
            (self.on_change)(&after);
        }
        outcome
    }

    /// Plugs a part in, and starts it at once if the environment is on. Plugging into a part that is
    /// already plugged in stops the old one first.
    pub fn register(&self, id: ModuleId, lifecycle: Box<dyn Lifecycle>) {
        self.changing(|inner, restore| {
            if inner.is_running(id) {
                inner.stop_one(id, restore);
            }
            let slot = inner.slot(id);
            slot.lifecycle = Some(lifecycle);
            slot.error = None;
            inner.reconcile(restore);
        });
    }

    /// Switches the whole environment on or off, now. The choice is saved before anything starts or
    /// stops. A part that then fails to start is reported in [`Environment::problems`]; the rest runs.
    pub fn set_environment(&self, on: bool) -> Result<Environment, ModuleError> {
        self.changing(|inner, restore| inner.set_environment(on, restore).map(|()| inner.environment()))
    }

    /// Keeps the Windows taskbar (`true`) or lets the dock's replacement take its place (`false`), now.
    /// When the replacement fails to start, the choice is put back and the reason is returned.
    pub fn set_windows_taskbar(&self, use_windows: bool) -> Result<Environment, ModuleError> {
        self.changing(|inner, restore| inner.set_windows_taskbar(use_windows, restore).map(|()| inner.environment()))
    }

    pub fn environment(&self) -> Environment {
        self.lock().environment()
    }

    pub fn statuses(&self) -> Vec<ModuleStatus> {
        self.lock().statuses()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    type Log = Arc<Mutex<Vec<String>>>;

    fn entries(log: &Log) -> Vec<String> {
        log.lock().expect("log").clone()
    }

    fn clear(log: &Log) {
        log.lock().expect("log").clear();
    }

    /// Records what the manager asks of it.
    struct Probe {
        name: &'static str,
        log: Log,
        fail_with: Option<&'static str>,
    }

    impl Lifecycle for Probe {
        fn start(&mut self) -> Result<(), String> {
            self.log.lock().expect("log").push(format!("start {}", self.name));
            self.fail_with.map_or(Ok(()), |reason| Err(reason.to_owned()))
        }

        fn stop(&mut self) {
            self.log.lock().expect("log").push(format!("stop {}", self.name));
        }
    }

    fn probe(name: &'static str, log: &Log) -> Box<Probe> {
        Box::new(Probe { name, log: Arc::clone(log), fail_with: None })
    }

    fn failing(name: &'static str, log: &Log, reason: &'static str) -> Box<Probe> {
        Box::new(Probe { name, log: Arc::clone(log), fail_with: Some(reason) })
    }

    struct Rig {
        modules: Modules,
        log: Log,
        restores: Arc<AtomicUsize>,
        heard: Arc<Mutex<Vec<Vec<ModuleStatus>>>>,
    }

    fn rig(dir: Option<&Path>) -> Rig {
        let log: Log = Arc::default();
        let restores = Arc::new(AtomicUsize::new(0));
        let heard: Arc<Mutex<Vec<Vec<ModuleStatus>>>> = Arc::default();
        let (counted, sink) = (Arc::clone(&restores), Arc::clone(&heard));
        let restore_log = Arc::clone(&log);
        let modules = Modules::new(
            dir,
            move || {
                counted.fetch_add(1, Ordering::SeqCst);
                restore_log.lock().expect("log").push("restore taskbar".to_owned());
            },
            move |statuses| sink.lock().expect("heard").push(statuses.to_vec()),
        );
        Rig { modules, log, restores, heard }
    }

    /// Every part plugged in, as the finished app has them.
    fn full(dir: Option<&Path>) -> Rig {
        let r = rig(dir);
        let parts = [
            (ModuleId::Home, "home"),
            (ModuleId::Dock, "dock"),
            (ModuleId::Taskbar, "taskbar"),
            (ModuleId::Notch, "notch"),
        ];
        for (id, name) in parts {
            r.modules.register(id, probe(name, &r.log));
        }
        r
    }

    fn state(modules: &Modules, id: ModuleId) -> State {
        modules.statuses().into_iter().find(|s| s.id == id).expect("status").state
    }

    #[test]
    fn the_whole_environment_is_on_by_default_and_the_dock_replaces_the_taskbar() {
        let r = full(None);
        assert_eq!(entries(&r.log), ["start home", "start dock", "start taskbar", "start notch"]);
        assert_eq!(
            r.modules.environment(),
            Environment { on: true, windows_taskbar: false, taskbar_replacement: true, problems: vec![] }
        );
    }

    #[test]
    fn a_part_starts_as_soon_as_it_is_plugged_in_while_the_environment_is_on() {
        let r = rig(None);
        r.modules.register(ModuleId::Home, probe("home", &r.log));
        assert_eq!(entries(&r.log), ["start home"]);
        assert_eq!(state(&r.modules, ModuleId::Home), State::Running);
    }

    #[test]
    fn switching_the_environment_off_stops_every_part_the_replacement_first_and_restores_the_taskbar() {
        let r = full(None);
        clear(&r.log);
        let after = r.modules.set_environment(false).expect("off");
        assert_eq!(
            entries(&r.log),
            ["stop notch", "stop taskbar", "restore taskbar", "stop dock", "stop home"],
            "reverse start order, with the real taskbar back right after the replacement"
        );
        assert!(!after.on);
        assert!(r.modules.statuses().iter().all(|s| s.state == State::Stopped));
    }

    #[test]
    fn switching_the_environment_back_on_starts_every_part_in_order() {
        let r = full(None);
        r.modules.set_environment(false).expect("off");
        clear(&r.log);
        r.modules.set_environment(true).expect("on");
        assert_eq!(entries(&r.log), ["start home", "start dock", "start taskbar", "start notch"]);
        assert!(r.modules.statuses().iter().all(|s| s.state == State::Running));
    }

    #[test]
    fn switching_the_environment_to_the_state_it_is_in_does_nothing() {
        let r = full(None);
        clear(&r.log);
        r.modules.set_environment(true).expect("already on");
        r.modules.set_environment(false).expect("off");
        r.modules.set_environment(false).expect("already off");
        assert_eq!(entries(&r.log).iter().filter(|e| e.starts_with("stop")).count(), 4);
        assert_eq!(r.restores.load(Ordering::SeqCst), 1, "the taskbar is restored once, not once per call");
    }

    #[test]
    fn a_part_plugged_in_while_the_environment_is_off_waits_for_it_to_come_back() {
        let r = rig(None);
        r.modules.set_environment(false).expect("off");
        r.modules.register(ModuleId::Home, probe("home", &r.log));
        assert!(entries(&r.log).is_empty());
        r.modules.set_environment(true).expect("on");
        assert_eq!(entries(&r.log), ["start home"]);
    }

    #[test]
    fn the_windows_taskbar_choice_puts_the_real_taskbar_back_and_hides_the_dock() {
        let r = full(None);
        clear(&r.log);
        let after = r.modules.set_windows_taskbar(true).expect("windows taskbar");
        assert_eq!(entries(&r.log), ["stop taskbar", "restore taskbar", "stop dock"]);
        assert!(after.windows_taskbar && after.on);
        assert_eq!(state(&r.modules, ModuleId::Dock), State::Stopped);
        assert_eq!(state(&r.modules, ModuleId::Taskbar), State::Stopped);
        assert_eq!(state(&r.modules, ModuleId::Home), State::Running, "the rest of the environment stays");
    }

    #[test]
    fn switching_back_to_the_dock_taskbar_starts_the_replacement_again() {
        let r = full(None);
        r.modules.set_windows_taskbar(true).expect("windows taskbar");
        clear(&r.log);
        let after = r.modules.set_windows_taskbar(false).expect("dock taskbar");
        assert_eq!(entries(&r.log), ["start dock", "start taskbar"]);
        assert!(!after.windows_taskbar);
    }

    #[test]
    fn choosing_the_windows_taskbar_while_the_environment_is_off_is_saved_and_starts_nothing() {
        let dir = tempfile::tempdir().expect("dir");
        let r = full(Some(dir.path()));
        r.modules.set_environment(false).expect("off");
        clear(&r.log);
        r.modules.set_windows_taskbar(true).expect("windows taskbar");
        r.modules.set_environment(true).expect("on");
        assert_eq!(entries(&r.log), ["start home", "start notch"], "no dock and no replacement: the choice held");
    }

    #[test]
    fn the_windows_taskbar_stays_when_this_build_has_no_replacement_and_cannot_be_given_up() {
        let r = rig(None);
        r.modules.register(ModuleId::Home, probe("home", &r.log));
        assert_eq!(
            r.modules.environment(),
            Environment { on: true, windows_taskbar: true, taskbar_replacement: false, problems: vec![] }
        );
        assert_eq!(r.modules.set_windows_taskbar(false), Err(ModuleError::Unavailable(ModuleId::Taskbar)));
        assert!(r.modules.set_windows_taskbar(true).is_ok(), "asking for what is already so is fine");
    }

    #[test]
    fn the_taskbar_replacement_waits_for_the_dock_and_never_starts_without_it() {
        let r = rig(None);
        r.modules.register(ModuleId::Taskbar, probe("taskbar", &r.log));
        assert!(entries(&r.log).is_empty());
        assert_eq!(state(&r.modules, ModuleId::Taskbar), State::Waiting);
        r.modules.register(ModuleId::Dock, probe("dock", &r.log));
        assert_eq!(entries(&r.log), ["start dock", "start taskbar"]);
    }

    #[test]
    fn a_replacement_that_fails_to_start_puts_the_choice_back_and_restores_the_real_taskbar() {
        let dir = tempfile::tempdir().expect("dir");
        let r = rig(Some(dir.path()));
        r.modules.register(ModuleId::Dock, probe("dock", &r.log));
        r.modules.register(ModuleId::Taskbar, failing("taskbar", &r.log, "Explorer keeps showing the taskbar"));
        assert_eq!(r.modules.environment().problems, ["Taskbar replacement: Explorer keeps showing the taskbar"]);
        r.modules.set_windows_taskbar(true).expect("windows taskbar");
        assert!(r.modules.environment().problems.is_empty(), "switching away is a fresh start");
        let outcome = r.modules.set_windows_taskbar(false);
        assert_eq!(
            outcome,
            Err(ModuleError::StartFailed {
                module: ModuleId::Taskbar,
                reason: "Explorer keeps showing the taskbar".to_owned()
            })
        );
        assert!(r.modules.environment().windows_taskbar, "the switch is back on Windows");
        assert_eq!(state(&r.modules, ModuleId::Dock), State::Stopped, "and the dock went with it");
        assert!(load(&dir.path().join(FILE)).windows_taskbar, "and the file says so too");
        assert!(r.restores.load(Ordering::SeqCst) >= 2, "every failed start restores the real taskbar");
    }

    #[test]
    fn one_part_failing_does_not_stop_the_others_and_is_reported_in_words() {
        let r = rig(None);
        r.modules.register(ModuleId::Home, probe("home", &r.log));
        r.modules.register(ModuleId::Notch, failing("notch", &r.log, "No Claude Code folder was found."));
        let environment = r.modules.environment();
        assert!(environment.on);
        assert_eq!(environment.problems, ["Notch: No Claude Code folder was found."]);
        assert_eq!(state(&r.modules, ModuleId::Home), State::Running);
        assert_eq!(state(&r.modules, ModuleId::Notch), State::Failed);
    }

    #[test]
    fn switching_the_environment_off_and_on_gives_a_failed_part_a_fresh_attempt() {
        let r = rig(None);
        r.modules.register(ModuleId::Notch, failing("notch", &r.log, "no folder"));
        r.modules.set_environment(false).expect("off");
        assert!(r.modules.environment().problems.is_empty());
        r.modules.register(ModuleId::Notch, probe("notch", &r.log));
        r.modules.set_environment(true).expect("on");
        assert_eq!(state(&r.modules, ModuleId::Notch), State::Running);
    }

    #[test]
    fn both_choices_survive_a_restart() {
        let dir = tempfile::tempdir().expect("dir");
        let first = full(Some(dir.path()));
        first.modules.set_windows_taskbar(true).expect("windows taskbar");
        first.modules.set_environment(false).expect("off");

        let second = full(Some(dir.path()));
        assert!(entries(&second.log).is_empty(), "the environment stays off");
        assert_eq!(
            second.modules.environment(),
            Environment { on: false, windows_taskbar: true, taskbar_replacement: true, problems: vec![] }
        );
        second.modules.set_environment(true).expect("on");
        assert_eq!(entries(&second.log), ["start home", "start notch"], "the Windows taskbar, so no dock");
    }

    #[test]
    fn a_missing_or_damaged_file_means_the_defaults() {
        let dir = tempfile::tempdir().expect("dir");
        assert_eq!(load(&dir.path().join(FILE)), Choices::default());
        for content in ["", "{", "not json", r#"{"schema":1,"environment":"yes"}"#] {
            std::fs::write(dir.path().join(FILE), content).expect("write");
            assert_eq!(load(&dir.path().join(FILE)), Choices::default(), "content {content:?}");
        }
    }

    #[test]
    fn a_file_with_only_some_fields_keeps_the_default_for_the_rest() {
        let dir = tempfile::tempdir().expect("dir");
        std::fs::write(dir.path().join(FILE), r#"{"schema":2,"windowsTaskbar":true,"search":true}"#).expect("write");
        assert_eq!(load(&dir.path().join(FILE)), Choices { environment: true, windows_taskbar: true });
    }

    #[test]
    fn the_file_is_replaced_whole_and_leaves_no_temporary_file() {
        let dir = tempfile::tempdir().expect("dir");
        let r = full(Some(dir.path()));
        r.modules.set_environment(false).expect("off");
        r.modules.set_environment(true).expect("on");
        let names: Vec<_> =
            std::fs::read_dir(dir.path()).expect("list").map(|e| e.expect("entry").file_name()).collect();
        assert_eq!(names, [std::ffi::OsString::from(FILE)]);
    }

    #[test]
    fn a_choice_that_cannot_be_saved_changes_nothing() {
        let dir = tempfile::tempdir().expect("dir");
        let r = full(Some(dir.path()));
        std::fs::create_dir(dir.path().join("modules.json.tmp")).expect("block the temporary file");
        clear(&r.log);
        assert!(matches!(r.modules.set_environment(false), Err(ModuleError::Storage(_))));
        assert!(matches!(r.modules.set_windows_taskbar(true), Err(ModuleError::Storage(_))));
        assert!(entries(&r.log).is_empty(), "nothing was stopped");
        assert!(r.modules.environment().on);
        assert!(!r.modules.environment().windows_taskbar);
    }

    #[test]
    fn replacing_a_running_part_stops_the_old_one_first() {
        let r = rig(None);
        r.modules.register(ModuleId::Home, probe("old", &r.log));
        r.modules.register(ModuleId::Home, probe("new", &r.log));
        assert_eq!(entries(&r.log), ["start old", "stop old", "start new"]);
    }

    #[test]
    fn listeners_hear_each_change_but_not_a_repeat() {
        let r = full(None);
        let heard = |r: &Rig| r.heard.lock().expect("heard").len();
        let after_plugging_in = heard(&r);
        r.modules.set_environment(true).expect("already on");
        assert_eq!(heard(&r), after_plugging_in);
        r.modules.set_environment(false).expect("off");
        assert_eq!(heard(&r), after_plugging_in + 1);
        let last = r.heard.lock().expect("heard").last().cloned().expect("last");
        assert!(last.iter().all(|s| s.state == State::Stopped));
    }

    #[test]
    fn what_settings_reads_is_camel_case() {
        let environment = Environment { on: true, windows_taskbar: false, taskbar_replacement: true, problems: vec![] };
        assert_eq!(
            serde_json::to_string(&environment).expect("json"),
            r#"{"on":true,"windowsTaskbar":false,"taskbarReplacement":true,"problems":[]}"#
        );
    }

    #[test]
    fn a_sentence_can_start_with_a_part_name() {
        assert_eq!(capitalised("home screen"), "Home screen");
        assert_eq!(capitalised(""), "");
    }
}

//! The parts of dotDock that can be switched on and off on their own: the home screen, the dock,
//! the taskbar replacement and the notch (Agent Island).
//!
//! Each part plugs in as a [`Lifecycle`]: `start` brings it up, `stop` takes it down completely,
//! with no window, thread or changed Windows setting left behind. [`Modules`] owns the user's
//! choices (persisted in `modules.json`) and brings the running parts in line with them whenever a
//! choice changes, at run time, without a restart.
//!
//! Rules the manager enforces so no lifecycle has to:
//! - a lifecycle is started only while stopped and stopped only while running;
//! - the taskbar replacement needs the dock: it starts after it, stops before it, and turning the
//!   dock off turns it off too;
//! - whenever the taskbar replacement stops, or fails to start, the real taskbar is put back by
//!   `restore_taskbar` as well, whatever the lifecycle itself did;
//! - a part with no lifecycle (not in this build) cannot be switched on, and says so.
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
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum ModuleId {
    Home,
    Dock,
    Taskbar,
    Notch,
}

impl ModuleId {
    pub const ALL: [Self; 4] = [Self::Home, Self::Dock, Self::Taskbar, Self::Notch];

    /// The key used in `modules.json`.
    const fn key(self) -> &'static str {
        match self {
            Self::Home => "home",
            Self::Dock => "dock",
            Self::Taskbar => "taskbar",
            Self::Notch => "notch",
        }
    }

    /// How the part is named in a sentence.
    pub const fn label(self) -> &'static str {
        match self {
            Self::Home => "home screen",
            Self::Dock => "dock",
            Self::Taskbar => "taskbar replacement",
            Self::Notch => "notch",
        }
    }

    /// Everything is on except the taskbar replacement: hiding the Windows taskbar is a bigger step
    /// than adding a dock, so it is something a person chooses.
    pub const fn default_enabled(self) -> bool {
        !matches!(self, Self::Taskbar)
    }

    /// The part that has to be on for this one to make sense.
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
    #[error("the {} needs the {} to be on", .module.label(), .needs.label())]
    Requires { module: ModuleId, needs: ModuleId },
    #[error("the {} did not start: {reason}", .module.label())]
    StartFailed { module: ModuleId, reason: String },
    #[error("the choice could not be saved: {0}")]
    Storage(String),
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum State {
    Running,
    /// Off, by choice.
    Stopped,
    /// On, but the part it needs is not running.
    Waiting,
    /// On, and the last attempt to start it failed.
    Failed,
    /// No lifecycle is plugged in: this build does not have the part.
    Unavailable,
}

/// What Settings shows for one part.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModuleStatus {
    pub id: ModuleId,
    /// The user's choice. Always false for a part that is not in this build.
    pub enabled: bool,
    pub state: State,
    pub requires: Option<ModuleId>,
    /// Why the last start failed, while `state` is `Failed`.
    pub error: Option<String>,
}

// ---------------------------------------------------------------- choices

#[derive(Clone, Debug, PartialEq, Eq)]
struct Choices(BTreeMap<ModuleId, bool>);

impl Default for Choices {
    fn default() -> Self {
        Self(ModuleId::ALL.iter().map(|id| (*id, id.default_enabled())).collect())
    }
}

impl Choices {
    fn is_enabled(&self, id: ModuleId) -> bool {
        self.0.get(&id).copied().unwrap_or_else(|| id.default_enabled())
    }

    fn set(&mut self, id: ModuleId, enabled: bool) {
        self.0.insert(id, enabled);
        self.settle();
    }

    /// A part cannot be on without the one it needs. Applied after every change and every load.
    fn settle(&mut self) {
        for id in ModuleId::ALL {
            if id.requires().is_some_and(|needs| !self.is_enabled(needs)) {
                self.0.insert(id, false);
            }
        }
    }
}

/// The file on disk. Keys are strings so a file written by a newer build, with a part this one has not
/// heard of, still loads.
#[derive(Serialize, Deserialize)]
struct Stored {
    schema: u32,
    enabled: BTreeMap<String, bool>,
}

fn load(path: &Path) -> Choices {
    let mut choices = Choices::default();
    let stored = std::fs::read(path).ok().and_then(|bytes| serde_json::from_slice::<Stored>(&bytes).ok());
    for (key, enabled) in stored.map(|s| s.enabled).unwrap_or_default() {
        if let Some(id) = ModuleId::ALL.into_iter().find(|id| id.key() == key) {
            choices.0.insert(id, enabled);
        }
    }
    choices.settle();
    choices
}

/// Write-then-rename, flushed to disk, so a power cut leaves the old file or the new one, never half.
fn save(path: &Path, choices: &Choices) -> std::io::Result<()> {
    let stored = Stored {
        schema: SCHEMA,
        enabled: ModuleId::ALL.iter().map(|id| (id.key().to_owned(), choices.is_enabled(*id))).collect(),
    };
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

impl Inner {
    fn slot(&mut self, id: ModuleId) -> &mut Slot {
        self.slots.entry(id).or_default()
    }

    fn is_running(&self, id: ModuleId) -> bool {
        self.slots.get(&id).is_some_and(|s| s.running)
    }

    fn requirement_met(&self, id: ModuleId) -> bool {
        id.requires().is_none_or(|needs| self.is_running(needs))
    }

    fn status(&self, id: ModuleId) -> ModuleStatus {
        let slot = self.slots.get(&id);
        let available = slot.is_some_and(|s| s.lifecycle.is_some());
        let enabled = available && self.choices.is_enabled(id);
        let error = slot.and_then(|s| s.error.clone());
        let state = if !available {
            State::Unavailable
        } else if self.is_running(id) {
            State::Running
        } else if error.is_some() {
            State::Failed
        } else if enabled {
            State::Waiting
        } else {
            State::Stopped
        };
        ModuleStatus { id, enabled, state, requires: id.requires(), error }
    }

    fn statuses(&self) -> Vec<ModuleStatus> {
        ModuleId::ALL.iter().map(|id| self.status(*id)).collect()
    }

    fn persist(&self) -> Result<(), ModuleError> {
        match &self.path {
            Some(path) => save(path, &self.choices).map_err(|e| ModuleError::Storage(e.to_string())),
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
    /// before the parts they need), then starts what should (needs first).
    fn reconcile(&mut self, restore: &Restore) {
        for id in ModuleId::ALL.into_iter().rev() {
            let keep = self.choices.is_enabled(id) && self.requirement_met(id);
            if self.is_running(id) && !keep {
                self.stop_one(id, restore);
            }
        }
        for id in ModuleId::ALL {
            let wanted = self.choices.is_enabled(id) && self.requirement_met(id);
            let has_lifecycle = self.slots.get(&id).is_some_and(|s| s.lifecycle.is_some());
            if wanted && has_lifecycle && !self.is_running(id) && self.slots.get(&id).is_some_and(|s| s.error.is_none())
            {
                self.start_one(id, restore);
            }
        }
    }

    fn apply(&mut self, id: ModuleId, enabled: bool, restore: &Restore) -> Result<(), ModuleError> {
        if enabled {
            if self.slots.get(&id).is_none_or(|s| s.lifecycle.is_none()) {
                return Err(ModuleError::Unavailable(id));
            }
            if let Some(needs) = id.requires().filter(|needs| !self.choices.is_enabled(*needs)) {
                return Err(ModuleError::Requires { module: id, needs });
            }
        }
        if self.choices.is_enabled(id) == enabled && (!enabled || self.is_running(id)) {
            return Ok(());
        }
        let previous = self.choices.clone();
        self.choices.set(id, enabled);
        if let Err(error) = self.persist() {
            self.choices = previous;
            return Err(error);
        }
        // Switching a part off or on is a fresh attempt: the failure from before no longer applies.
        self.slot(id).error = None;
        self.reconcile(restore);
        let failure = enabled.then(|| self.slots.get(&id).and_then(|s| s.error.clone())).flatten();
        if let Some(reason) = failure {
            // It did not start, so the choice goes back to what it was: the switch must not say "on".
            self.choices = previous;
            // Saving the old choice is best effort: the file still holds it unless this very write fails.
            let _ = self.persist();
            self.slot(id).error = None;
            return Err(ModuleError::StartFailed { module: id, reason });
        }
        Ok(())
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

    /// Plugs a part in, and starts it at once if the user has it on. Plugging into a part that is
    /// already plugged in stops the old one first.
    pub fn register(&self, id: ModuleId, lifecycle: Box<dyn Lifecycle>) {
        let statuses = {
            let mut inner = self.lock();
            if inner.is_running(id) {
                inner.stop_one(id, &self.restore_taskbar);
            }
            let slot = inner.slot(id);
            slot.lifecycle = Some(lifecycle);
            slot.error = None;
            inner.reconcile(&self.restore_taskbar);
            inner.statuses()
        };
        (self.on_change)(&statuses);
    }

    /// Switches a part on or off, now. The choice is saved before anything starts or stops; if the
    /// part then fails to start, the choice is put back and the reason is returned.
    pub fn set_enabled(&self, id: ModuleId, enabled: bool) -> Result<Vec<ModuleStatus>, ModuleError> {
        let (outcome, before, after) = {
            let mut inner = self.lock();
            let before = inner.statuses();
            let outcome = inner.apply(id, enabled, &self.restore_taskbar);
            (outcome, before, inner.statuses())
        };
        if before != after {
            (self.on_change)(&after);
        }
        outcome.map(|()| after)
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

    fn state(modules: &Modules, id: ModuleId) -> State {
        modules.statuses().into_iter().find(|s| s.id == id).expect("status").state
    }

    #[test]
    fn everything_is_on_by_default_except_the_taskbar_replacement() {
        let defaults: Vec<_> = ModuleId::ALL.iter().map(|id| id.default_enabled()).collect();
        assert_eq!(defaults, [true, true, false, true]);
    }

    #[test]
    fn a_plugged_in_part_that_is_on_starts_at_once() {
        let r = rig(None);
        r.modules.register(ModuleId::Home, probe("home", &r.log));
        assert_eq!(entries(&r.log), ["start home"]);
        assert_eq!(state(&r.modules, ModuleId::Home), State::Running);
    }

    #[test]
    fn parts_that_are_not_plugged_in_are_unavailable_and_cannot_be_switched_on() {
        let r = rig(None);
        let dock = r.modules.statuses().into_iter().find(|s| s.id == ModuleId::Dock).expect("dock");
        assert_eq!((dock.state, dock.enabled), (State::Unavailable, false));
        assert_eq!(r.modules.set_enabled(ModuleId::Dock, true), Err(ModuleError::Unavailable(ModuleId::Dock)));
        assert!(entries(&r.log).is_empty());
    }

    #[test]
    fn switching_off_stops_the_part_and_switching_on_starts_it_again_each_exactly_once() {
        let r = rig(None);
        r.modules.register(ModuleId::Notch, probe("notch", &r.log));
        r.modules.set_enabled(ModuleId::Notch, false).expect("off");
        r.modules.set_enabled(ModuleId::Notch, false).expect("off again");
        assert_eq!(state(&r.modules, ModuleId::Notch), State::Stopped);
        r.modules.set_enabled(ModuleId::Notch, true).expect("on");
        r.modules.set_enabled(ModuleId::Notch, true).expect("on again");
        assert_eq!(entries(&r.log), ["start notch", "stop notch", "start notch"]);
        assert_eq!(state(&r.modules, ModuleId::Notch), State::Running);
    }

    #[test]
    fn a_part_the_user_switched_off_does_not_start_when_it_is_plugged_in_again() {
        let r = rig(None);
        r.modules.register(ModuleId::Home, probe("home", &r.log));
        r.modules.set_enabled(ModuleId::Home, false).expect("off");
        r.modules.register(ModuleId::Home, probe("home", &r.log));
        assert_eq!(entries(&r.log), ["start home", "stop home"]);
    }

    #[test]
    fn choices_survive_a_restart() {
        let dir = tempfile::tempdir().expect("dir");
        let first = rig(Some(dir.path()));
        first.modules.register(ModuleId::Home, probe("home", &first.log));
        first.modules.register(ModuleId::Notch, probe("notch", &first.log));
        first.modules.set_enabled(ModuleId::Home, false).expect("off");

        let second = rig(Some(dir.path()));
        second.modules.register(ModuleId::Home, probe("home", &second.log));
        second.modules.register(ModuleId::Notch, probe("notch", &second.log));
        assert_eq!(entries(&second.log), ["start notch"]);
        assert_eq!(state(&second.modules, ModuleId::Home), State::Stopped);
    }

    #[test]
    fn a_missing_or_damaged_file_means_the_defaults() {
        let dir = tempfile::tempdir().expect("dir");
        assert_eq!(load(&dir.path().join(FILE)), Choices::default());
        for content in ["", "{", "not json", r#"{"schema":1}"#, r#"{"schema":1,"enabled":{"home":"yes"}}"#] {
            std::fs::write(dir.path().join(FILE), content).expect("write");
            assert_eq!(load(&dir.path().join(FILE)), Choices::default(), "content {content:?}");
        }
    }

    #[test]
    fn a_part_this_build_has_not_heard_of_is_ignored_and_the_rest_is_kept() {
        let dir = tempfile::tempdir().expect("dir");
        std::fs::write(dir.path().join(FILE), r#"{"schema":9,"enabled":{"home":false,"search":true}}"#).expect("write");
        let choices = load(&dir.path().join(FILE));
        assert!(!choices.is_enabled(ModuleId::Home));
        assert!(choices.is_enabled(ModuleId::Notch));
    }

    #[test]
    fn the_file_is_replaced_whole_and_leaves_no_temporary_file() {
        let dir = tempfile::tempdir().expect("dir");
        let r = rig(Some(dir.path()));
        r.modules.register(ModuleId::Home, probe("home", &r.log));
        r.modules.set_enabled(ModuleId::Home, false).expect("off");
        r.modules.set_enabled(ModuleId::Home, true).expect("on");
        let names: Vec<_> =
            std::fs::read_dir(dir.path()).expect("list").map(|e| e.expect("entry").file_name()).collect();
        assert_eq!(names, [std::ffi::OsString::from(FILE)]);
    }

    #[test]
    fn a_taskbar_choice_without_the_dock_is_dropped_on_load() {
        let dir = tempfile::tempdir().expect("dir");
        std::fs::write(dir.path().join(FILE), r#"{"schema":1,"enabled":{"dock":false,"taskbar":true}}"#)
            .expect("write");
        assert!(!load(&dir.path().join(FILE)).is_enabled(ModuleId::Taskbar));
    }

    #[test]
    fn a_start_that_fails_at_launch_is_reported_and_leaves_the_choice_alone() {
        let r = rig(None);
        r.modules.register(ModuleId::Notch, failing("notch", &r.log, "no Claude folder"));
        let notch = r.modules.statuses().into_iter().find(|s| s.id == ModuleId::Notch).expect("notch");
        assert_eq!(notch.state, State::Failed);
        assert_eq!(notch.error.as_deref(), Some("no Claude folder"));
        assert!(notch.enabled);
    }

    #[test]
    fn a_start_that_fails_after_the_user_switched_it_on_puts_the_switch_back() {
        let dir = tempfile::tempdir().expect("dir");
        let r = rig(Some(dir.path()));
        r.modules.register(ModuleId::Notch, probe("notch", &r.log));
        r.modules.set_enabled(ModuleId::Notch, false).expect("off");
        r.modules.register(ModuleId::Notch, failing("notch", &r.log, "no Claude folder"));
        let outcome = r.modules.set_enabled(ModuleId::Notch, true);
        assert_eq!(
            outcome,
            Err(ModuleError::StartFailed { module: ModuleId::Notch, reason: "no Claude folder".to_owned() })
        );
        let notch = r.modules.statuses().into_iter().find(|s| s.id == ModuleId::Notch).expect("notch");
        assert_eq!((notch.enabled, notch.state, notch.error), (false, State::Stopped, None));
        assert!(!load(&dir.path().join(FILE)).is_enabled(ModuleId::Notch), "the file says off too");
    }

    #[test]
    fn a_part_that_failed_gets_a_fresh_attempt_when_switched_off_and_on() {
        let r = rig(None);
        r.modules.register(ModuleId::Home, failing("home", &r.log, "no window"));
        r.modules.set_enabled(ModuleId::Home, false).expect("off");
        r.modules.register(ModuleId::Home, probe("home", &r.log));
        r.modules.set_enabled(ModuleId::Home, true).expect("on");
        assert_eq!(state(&r.modules, ModuleId::Home), State::Running);
    }

    #[test]
    fn a_choice_that_cannot_be_saved_changes_nothing() {
        let dir = tempfile::tempdir().expect("dir");
        let r = rig(Some(dir.path()));
        r.modules.register(ModuleId::Home, probe("home", &r.log));
        std::fs::create_dir(dir.path().join("modules.json.tmp")).expect("block the temporary file");
        assert!(matches!(r.modules.set_enabled(ModuleId::Home, false), Err(ModuleError::Storage(_))));
        assert_eq!(state(&r.modules, ModuleId::Home), State::Running);
        assert_eq!(entries(&r.log), ["start home"]);
    }

    fn with_dock_and_taskbar(r: &Rig) {
        r.modules.register(ModuleId::Dock, probe("dock", &r.log));
        r.modules.register(ModuleId::Taskbar, probe("taskbar", &r.log));
    }

    #[test]
    fn the_taskbar_replacement_starts_only_after_the_dock_and_is_off_until_chosen() {
        let r = rig(None);
        with_dock_and_taskbar(&r);
        assert_eq!(entries(&r.log), ["start dock"]);
        r.modules.set_enabled(ModuleId::Taskbar, true).expect("on");
        assert_eq!(entries(&r.log), ["start dock", "start taskbar"]);
    }

    #[test]
    fn the_taskbar_replacement_cannot_be_switched_on_while_the_dock_is_off() {
        let r = rig(None);
        with_dock_and_taskbar(&r);
        r.modules.set_enabled(ModuleId::Dock, false).expect("dock off");
        assert_eq!(
            r.modules.set_enabled(ModuleId::Taskbar, true),
            Err(ModuleError::Requires { module: ModuleId::Taskbar, needs: ModuleId::Dock })
        );
    }

    #[test]
    fn switching_the_dock_off_takes_the_taskbar_replacement_down_first_and_the_real_taskbar_comes_back() {
        let r = rig(None);
        with_dock_and_taskbar(&r);
        r.modules.set_enabled(ModuleId::Taskbar, true).expect("on");
        r.log.lock().expect("log").clear();
        let after = r.modules.set_enabled(ModuleId::Dock, false).expect("dock off");
        assert_eq!(entries(&r.log), ["stop taskbar", "restore taskbar", "stop dock"]);
        let taskbar = after.iter().find(|s| s.id == ModuleId::Taskbar).expect("taskbar");
        assert!(!taskbar.enabled, "the taskbar choice goes off with the dock and stays off");
        r.modules.set_enabled(ModuleId::Dock, true).expect("dock on");
        assert_eq!(state(&r.modules, ModuleId::Taskbar), State::Stopped);
    }

    #[test]
    fn switching_the_taskbar_replacement_off_restores_the_real_taskbar_exactly_once() {
        let r = rig(None);
        with_dock_and_taskbar(&r);
        r.modules.set_enabled(ModuleId::Taskbar, true).expect("on");
        r.modules.set_enabled(ModuleId::Taskbar, false).expect("off");
        r.modules.set_enabled(ModuleId::Taskbar, false).expect("off again");
        assert_eq!(r.restores.load(Ordering::SeqCst), 1);
        assert_eq!(entries(&r.log).last().map(String::as_str), Some("restore taskbar"));
    }

    #[test]
    fn the_real_taskbar_is_restored_even_when_the_replacement_fails_to_start() {
        let r = rig(None);
        r.modules.register(ModuleId::Dock, probe("dock", &r.log));
        r.modules.register(ModuleId::Taskbar, failing("taskbar", &r.log, "Explorer keeps showing the taskbar"));
        let outcome = r.modules.set_enabled(ModuleId::Taskbar, true);
        assert!(matches!(outcome, Err(ModuleError::StartFailed { module: ModuleId::Taskbar, .. })));
        assert_eq!(r.restores.load(Ordering::SeqCst), 1);
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
        let r = rig(None);
        r.modules.register(ModuleId::Home, probe("home", &r.log));
        let after_register = r.heard.lock().expect("heard").len();
        r.modules.set_enabled(ModuleId::Home, true).expect("already on");
        assert_eq!(r.heard.lock().expect("heard").len(), after_register);
        r.modules.set_enabled(ModuleId::Home, false).expect("off");
        let heard = r.heard.lock().expect("heard");
        assert_eq!(heard.len(), after_register + 1);
        let last = heard.last().expect("last");
        assert_eq!(last.iter().find(|s| s.id == ModuleId::Home).map(|s| s.state), Some(State::Stopped));
    }

    #[test]
    fn statuses_serialise_the_way_settings_reads_them() {
        let status = ModuleStatus {
            id: ModuleId::Taskbar,
            enabled: true,
            state: State::Waiting,
            requires: Some(ModuleId::Dock),
            error: None,
        };
        assert_eq!(
            serde_json::to_string(&status).expect("json"),
            r#"{"id":"taskbar","enabled":true,"state":"waiting","requires":"dock","error":null}"#
        );
    }
}

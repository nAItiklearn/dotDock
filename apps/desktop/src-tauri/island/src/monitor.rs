//! The island's event loop: watches the hook state folder, active transcripts and Codex logs, feeds the
//! engine, and hands finished snapshots and alerts to a callback. It sleeps until the file system reports a
//! change or the engine's next deadline arrives; nothing is polled except process liveness, every few seconds,
//! and only while a session with a known process is active.

use crate::codex::{self, CodexReader};
use crate::engine::{Alert, Engine, EngineConfig, Snapshot};
use crate::feed::{self, FeedReader};
use crate::focus::{focus_session, FocusOutcome};
use crate::paths::ClaudeDirs;
use crate::process::is_alive;
use crate::state::{self, SessionState};
use crate::transcript::{read_tail, tail_event, TailEvent, TurnCounter, TAIL_BYTES};
use crate::util::now_ms;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::Duration;

/// A burst of file events (a hook writes a temp file, renames it, the transcript grows) is handled as one.
const DEBOUNCE: Duration = Duration::from_millis(20);
/// How often a running session's process is checked while one is active.
const LIVENESS_PERIOD_MS: u64 = 4_000;
/// Housekeeping: drop and delete state files nobody has touched for a long time.
const MAINTENANCE_PERIOD_MS: u64 = 3_600_000;
/// Longest the loop sleeps when nothing is scheduled.
const IDLE_WAIT: Duration = Duration::from_secs(3_600);
/// Codex logs written within this window at startup are picked up immediately.
const CODEX_RECENT: Duration = Duration::from_secs(600);
/// Feed files written within this window at startup are picked up immediately.
const FEED_RECENT: Duration = Duration::from_secs(600);

#[derive(Debug, thiserror::Error)]
pub enum MonitorError {
    #[error("file watcher: {0}")]
    Watch(#[from] notify::Error),
    #[error("monitor thread: {0}")]
    Thread(#[from] std::io::Error),
}

pub struct MonitorConfig {
    pub dirs: ClaudeDirs,
    /// `~\.codex\sessions`; `None` or a missing folder means no Codex support.
    pub codex_root: Option<PathBuf>,
    pub codex_enabled: bool,
    /// The agent feed folder (`docs/ISLAND_PROTOCOL.md`); created when missing.
    pub feed_dir: PathBuf,
    pub engine: EngineConfig,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Output {
    Snapshot(Snapshot),
    Alert(Alert),
}

enum Msg {
    Fs(Event),
    /// Something outside changed state (dismiss, settings): recompute and publish.
    Wake,
    Rescan,
    Stop,
}

/// Owns the loop thread; dropping the handle stops it.
pub struct MonitorHandle {
    engine: Arc<Mutex<Engine>>,
    tx: Sender<Msg>,
    codex_enabled: Arc<Mutex<bool>>,
    thread: Option<JoinHandle<()>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl MonitorHandle {
    /// Hides a session until its next update.
    pub fn dismiss(&self, id: &str) {
        lock(&self.engine).dismiss(id);
        let _ = self.tx.send(Msg::Wake);
    }

    pub fn set_engine_config(&self, cfg: EngineConfig) {
        lock(&self.engine).set_config(cfg);
        let _ = self.tx.send(Msg::Wake);
    }

    /// Turns Codex support on or off at run time.
    pub fn set_codex_enabled(&self, enabled: bool) {
        *lock(&self.codex_enabled) = enabled;
        let _ = self.tx.send(Msg::Rescan);
    }

    /// Re-reads everything. Call after Connect, which may have just created the folders to watch.
    pub fn rescan(&self) {
        let _ = self.tx.send(Msg::Rescan);
    }

    /// Brings the terminal of a session to the front.
    pub fn focus(&self, id: &str) -> FocusOutcome {
        let found = lock(&self.engine).state_of(id).map(|s| (s.pid, s.pid_start, s.project.clone()));
        match found {
            Some((pid, start, project)) => focus_session(pid, start, &project),
            None => FocusOutcome::SessionEnded,
        }
    }
}

impl Drop for MonitorHandle {
    fn drop(&mut self) {
        let _ = self.tx.send(Msg::Stop);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Starts watching. `sink` runs on the monitor thread and must not block.
pub fn spawn(cfg: MonitorConfig, sink: impl Fn(Output) + Send + 'static) -> Result<MonitorHandle, MonitorError> {
    let (tx, rx) = channel::<Msg>();
    let watcher_tx = tx.clone();
    let watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
        if let Ok(event) = event {
            let _ = watcher_tx.send(Msg::Fs(event));
        }
    })?;
    let engine = Arc::new(Mutex::new(Engine::new(cfg.engine.clone())));
    let codex_enabled = Arc::new(Mutex::new(cfg.codex_enabled));
    let mut worker = Worker {
        dirs: cfg.dirs,
        codex_root: cfg.codex_root,
        engine: Arc::clone(&engine),
        codex_enabled: Arc::clone(&codex_enabled),
        feed_dir: cfg.feed_dir,
        watcher,
        watched: HashSet::new(),
        counters: HashMap::new(),
        probed_size: HashMap::new(),
        codex: CodexReader::new(),
        feed: FeedReader::new(),
        transcript_owner: HashMap::new(),
        sink: Box::new(sink),
        last_seq: None,
        last_liveness: 0,
        last_maintenance: 0,
    };
    let thread = std::thread::Builder::new().name("island-monitor".into()).spawn(move || worker.run(&rx))?;
    Ok(MonitorHandle { engine, tx, codex_enabled, thread: Some(thread) })
}

struct Worker {
    dirs: ClaudeDirs,
    codex_root: Option<PathBuf>,
    engine: Arc<Mutex<Engine>>,
    codex_enabled: Arc<Mutex<bool>>,
    feed_dir: PathBuf,
    watcher: RecommendedWatcher,
    watched: HashSet<PathBuf>,
    counters: HashMap<String, TurnCounter>,
    /// lower-cased transcript path to its size at the last probe
    probed_size: HashMap<String, u64>,
    codex: CodexReader,
    feed: FeedReader,
    /// lower-cased transcript path to session id
    transcript_owner: HashMap<String, String>,
    sink: Box<dyn Fn(Output) + Send>,
    last_seq: Option<u64>,
    last_liveness: u64,
    last_maintenance: u64,
}

fn key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

/// Everything one pass of the loop has to look at.
#[derive(Default)]
struct Dirty {
    state_files: HashSet<PathBuf>,
    transcripts: HashSet<String>,
    codex_logs: HashSet<PathBuf>,
    feed_logs: HashSet<PathBuf>,
}

impl Worker {
    fn run(&mut self, rx: &std::sync::mpsc::Receiver<Msg>) {
        self.rescan();
        loop {
            let now = now_ms();
            let deadline = lock(&self.engine)
                .next_deadline(now)
                .map(|d| Duration::from_millis(d.saturating_sub(now)))
                .unwrap_or(IDLE_WAIT);
            let wait = if self.has_active_sessions() {
                deadline.min(Duration::from_millis(LIVENESS_PERIOD_MS))
            } else {
                deadline
            };
            let mut dirty = Dirty::default();
            match rx.recv_timeout(wait) {
                Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => return,
                Ok(Msg::Rescan) => self.rescan(),
                Ok(Msg::Fs(event)) => self.collect(&event, &mut dirty),
                Ok(Msg::Wake) | Err(RecvTimeoutError::Timeout) => {}
            }
            // Coalesce whatever else arrives within the debounce window.
            loop {
                match rx.recv_timeout(DEBOUNCE) {
                    Ok(Msg::Fs(event)) => self.collect(&event, &mut dirty),
                    Ok(Msg::Rescan) => self.rescan(),
                    Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => return,
                    Ok(Msg::Wake) => {}
                    Err(RecvTimeoutError::Timeout) => break,
                }
            }
            self.process(dirty);
            self.housekeeping();
            self.publish();
        }
    }

    fn has_active_sessions(&self) -> bool {
        lock(&self.engine).has_active()
    }

    fn collect(&self, event: &Event, dirty: &mut Dirty) {
        let sessions = self.dirs.sessions_dir();
        for path in &event.paths {
            if state::is_state_file(path) && path.parent() == Some(sessions.as_path()) {
                dirty.state_files.insert(path.clone());
            } else if self.transcript_owner.contains_key(&key(path)) {
                dirty.transcripts.insert(key(path));
            } else if self.codex_root.as_deref().is_some_and(|root| path.starts_with(root)) && codex::is_rollout(path) {
                dirty.codex_logs.insert(path.clone());
            } else if path.starts_with(&self.feed_dir) && feed::is_feed_file(path) {
                dirty.feed_logs.insert(path.clone());
            }
        }
    }

    /// Full reload: state files, Codex logs, watches.
    fn rescan(&mut self) {
        let config_dir = self.dirs.config_dir().to_owned();
        let sessions = self.dirs.sessions_dir();
        if config_dir.exists() {
            if std::fs::create_dir_all(&sessions).is_ok() {
                self.watch(&sessions);
            }
            let mut dirty = Dirty::default();
            if let Ok(entries) = std::fs::read_dir(&sessions) {
                dirty
                    .state_files
                    .extend(entries.filter_map(Result::ok).map(|e| e.path()).filter(|p| state::is_state_file(p)));
            }
            self.process(dirty);
        }
        if std::fs::create_dir_all(&self.feed_dir).is_ok() {
            let feed_dir = self.feed_dir.clone();
            self.watch(&feed_dir);
            let dirty = Dirty { feed_logs: feed::recent_files(&feed_dir, FEED_RECENT).into_iter().collect(), ..Dirty::default() };
            self.process(dirty);
        }
        let enabled = *lock(&self.codex_enabled);
        if let Some(root) = self.codex_root.clone().filter(|r| r.exists()) {
            if enabled {
                if self.watched.insert(root.clone()) {
                    let _ = self.watcher.watch(&root, RecursiveMode::Recursive);
                }
                let dirty = Dirty {
                    codex_logs: codex::recent_files(&root, CODEX_RECENT).into_iter().collect(),
                    ..Dirty::default()
                };
                self.process(dirty);
            } else {
                if self.watched.remove(&root) {
                    let _ = self.watcher.unwatch(&root);
                }
                let mut engine = lock(&self.engine);
                for id in codex_ids(&engine) {
                    engine.remove(&id);
                }
            }
        }
        self.publish();
    }

    fn watch(&mut self, dir: &Path) {
        if self.watched.insert(dir.to_owned()) && self.watcher.watch(dir, RecursiveMode::NonRecursive).is_err() {
            self.watched.remove(dir);
        }
    }

    fn process(&mut self, dirty: Dirty) {
        let mut changed_transcripts: HashSet<String> = dirty.transcripts;
        for path in dirty.state_files {
            let id = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            match SessionState::read(&path) {
                Ok(state) => {
                    if let Some(transcript) = state.transcript.as_deref() {
                        let transcript = PathBuf::from(transcript);
                        if let Some(parent) = transcript.parent() {
                            self.watch(parent);
                        }
                        self.transcript_owner.insert(key(&transcript), state.session_id.clone());
                        changed_transcripts.insert(key(&transcript));
                    }
                    lock(&self.engine).apply_state(state);
                }
                Err(_) if !path.exists() => {
                    lock(&self.engine).remove(&id);
                    self.counters.remove(&id);
                }
                // A half-written or foreign file: the next event brings the real one.
                Err(_) => {}
            }
        }
        if *lock(&self.codex_enabled) {
            for path in dirty.codex_logs {
                if let Some(update) = self.codex.read(&path) {
                    lock(&self.engine).apply_state(update.state);
                }
            }
        }
        for path in dirty.feed_logs {
            if !path.exists() {
                self.feed.forget(&path);
                continue;
            }
            for state in self.feed.read(&path, now_ms()) {
                lock(&self.engine).apply_state(state);
            }
        }
        self.probe_transcripts(&changed_transcripts);
    }

    /// Re-reads the tail and token count of every active session whose transcript changed.
    fn probe_transcripts(&mut self, changed: &HashSet<String>) {
        let targets: Vec<(String, PathBuf, u64, u64)> = lock(&self.engine)
            .transcript_targets()
            .into_iter()
            .filter_map(|(id, s)| {
                let path = PathBuf::from(s.transcript.as_deref()?);
                changed
                    .contains(&key(&path))
                    .then(|| (id.to_owned(), path, s.turn_started_at.unwrap_or(0), s.turn_offset))
            })
            .collect();
        for (id, path, turn_start, turn_offset) in targets {
            let read = read_tail(&path, TAIL_BYTES);
            if let Ok(tail) = &read {
                self.probed_size.insert(key(&path), tail.size);
            }
            let tail = read.map(|t| tail_event(&t.text, turn_start)).unwrap_or(TailEvent::None);
            let tokens = self.counters.entry(id.clone()).or_default().update(&path, turn_start, turn_offset);
            lock(&self.engine).set_transcript_view(&id, tail, tokens);
        }
    }

    /// Transcripts of active sessions whose size differs from the last probe. Windows can delay change
    /// notifications for a file that is held open for appending, so this catches what the watcher has not
    /// reported yet. One `stat` per active session per tick.
    fn grown_transcripts(&self) -> HashSet<String> {
        let paths: Vec<PathBuf> = lock(&self.engine)
            .transcript_targets()
            .into_iter()
            .filter_map(|(_, s)| s.transcript.as_deref().map(PathBuf::from))
            .collect();
        paths
            .into_iter()
            .filter(|p| std::fs::metadata(p).is_ok_and(|m| self.probed_size.get(&key(p)) != Some(&m.len())))
            .map(|p| key(&p))
            .collect()
    }

    fn housekeeping(&mut self) {
        let now = now_ms();
        if now.saturating_sub(self.last_liveness) >= LIVENESS_PERIOD_MS {
            self.last_liveness = now;
            let targets = lock(&self.engine).liveness_targets();
            for (id, pid, start) in targets {
                let alive = is_alive(pid, start);
                lock(&self.engine).set_alive(&id, alive, now);
            }
            let grown = self.grown_transcripts();
            self.probe_transcripts(&grown);
        }
        if now.saturating_sub(self.last_maintenance) >= MAINTENANCE_PERIOD_MS {
            self.last_maintenance = now;
            let forgotten = lock(&self.engine).forget_old(now);
            for id in &forgotten {
                self.counters.remove(id);
            }
            state::prune(&self.dirs.sessions_dir(), now.saturating_sub(MAINTENANCE_PERIOD_MS * 24));
            feed::prune(&self.feed_dir, feed::FILE_MAX_AGE);
            self.transcript_owner.retain(|_, id| lock(&self.engine).state_of(id).is_some());
        }
    }

    fn publish(&mut self) {
        let (snapshot, alerts) = lock(&self.engine).snapshot(now_ms());
        if self.last_seq != Some(snapshot.seq) {
            self.last_seq = Some(snapshot.seq);
            (self.sink)(Output::Snapshot(snapshot));
        }
        for alert in alerts {
            (self.sink)(Output::Alert(alert));
        }
    }
}

fn codex_ids(engine: &Engine) -> Vec<String> {
    engine.session_ids().into_iter().filter(|id| id.starts_with("codex-")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hook::{apply, HookEnv, HookInput};
    use crate::phase::Phase;
    use std::sync::mpsc::Receiver;

    const WAIT: Duration = Duration::from_secs(10);

    fn hook_event(session: &str, event: &str, extra: &str) -> HookInput {
        let json =
            format!(r#"{{"session_id":"{session}","hook_event_name":"{event}","cwd":"D:\\work\\dotDock"{extra}}}"#);
        crate::hook::read_input(json.as_bytes()).expect("hook input")
    }

    fn write_event(dirs: &ClaudeDirs, input: &HookInput, pid: Option<u32>) {
        let env = HookEnv {
            now_ms: now_ms(),
            now_ns: crate::util::now_ns(),
            parent: pid.map(|p| (p, None)),
            ..HookEnv::default()
        };
        let id = input.session_id.clone().expect("id");
        let prev = SessionState::read(&state::file_for(&dirs.sessions_dir(), &id)).ok();
        let next = apply(prev.as_ref(), input, &env).expect("state");
        next.write(&dirs.sessions_dir()).expect("write");
    }

    fn start(dir: &Path) -> (MonitorHandle, Receiver<Output>, ClaudeDirs) {
        let dirs = ClaudeDirs::at(dir.join(".claude"));
        std::fs::create_dir_all(dirs.config_dir()).expect("config dir");
        let (out_tx, out_rx) = channel();
        let sink_tx = Mutex::new(out_tx);
        let handle = spawn(
            MonitorConfig {
                dirs: dirs.clone(),
                codex_root: None,
                codex_enabled: false,
                feed_dir: dir.join("agents"),
                engine: EngineConfig { linger_done_ms: 60_000, linger_paused_ms: 60_000, ..EngineConfig::default() },
            },
            move |o| {
                let _ = lock(&sink_tx).send(o);
            },
        )
        .expect("spawn");
        (handle, out_rx, dirs)
    }

    fn next_snapshot_where(rx: &Receiver<Output>, accept: impl Fn(&Snapshot) -> bool) -> Snapshot {
        let started = std::time::Instant::now();
        while started.elapsed() < WAIT {
            if let Ok(Output::Snapshot(s)) = rx.recv_timeout(Duration::from_millis(200)) {
                if accept(&s) {
                    return s;
                }
            }
        }
        panic!("no matching snapshot within {WAIT:?}");
    }

    #[test]
    fn hook_files_flow_through_the_watcher_into_snapshots() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (handle, rx, dirs) = start(dir.path());
        let me = std::process::id();
        write_event(&dirs, &hook_event("s1", "UserPromptSubmit", ""), Some(me));
        let first = next_snapshot_where(&rx, |s| s.sessions.len() == 1);
        assert_eq!(first.sessions[0].phase, Phase::Thinking);
        write_event(
            &dirs,
            &hook_event("s1", "PreToolUse", r#","tool_name":"Read","tool_input":{"file_path":"C:\\a\\lib.rs"}"#),
            Some(me),
        );
        let reading = next_snapshot_where(&rx, |s| s.sessions.first().is_some_and(|v| v.phase == Phase::Reading));
        assert_eq!(reading.sessions[0].detail.as_deref(), Some("lib.rs"));
        write_event(&dirs, &hook_event("s1", "Stop", r#","last_assistant_message":"All done here""#), Some(me));
        let done = next_snapshot_where(&rx, |s| s.sessions.first().is_some_and(|v| v.phase == Phase::Done));
        assert_eq!(done.sessions[0].summary.as_deref(), Some("All done here"));
        let alert = std::iter::from_fn(|| rx.recv_timeout(Duration::from_millis(300)).ok()).find_map(|o| {
            if let Output::Alert(a) = o {
                Some(a)
            } else {
                None
            }
        });
        assert_eq!(alert.map(|a| a.kind), Some(crate::engine::AlertKind::Done));
        drop(handle);
    }

    #[test]
    fn a_session_collapses_by_itself_after_the_linger_time() {
        let dir = tempfile::tempdir().expect("tempdir");
        let dirs = ClaudeDirs::at(dir.path().join(".claude"));
        std::fs::create_dir_all(dirs.config_dir()).expect("config dir");
        let (out_tx, out_rx) = channel();
        let sink_tx = Mutex::new(out_tx);
        let cfg = EngineConfig { linger_done_ms: 300, ..EngineConfig::default() };
        let handle = spawn(
            MonitorConfig {
                dirs: dirs.clone(),
                codex_root: None,
                codex_enabled: false,
                feed_dir: dir.path().join("agents"),
                engine: cfg,
            },
            move |o| {
                let _ = lock(&sink_tx).send(o);
            },
        )
        .expect("spawn");
        write_event(&dirs, &hook_event("s1", "Stop", ""), None);
        next_snapshot_where(&out_rx, |s| s.sessions.len() == 1);
        let empty = next_snapshot_where(&out_rx, |s| s.sessions.is_empty());
        assert!(empty.current.is_none());
        drop(handle);
    }

    #[test]
    fn transcript_growth_updates_tokens_without_any_hook_event() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (handle, rx, dirs) = start(dir.path());
        let transcript = dir.path().join("t.jsonl");
        std::fs::write(&transcript, "").expect("transcript");
        let extra =
            format!(r#","transcript_path":{}"#, serde_json::to_string(&transcript.to_string_lossy()).expect("json"));
        write_event(&dirs, &hook_event("s1", "UserPromptSubmit", &extra), Some(std::process::id()));
        next_snapshot_where(&rx, |s| s.sessions.len() == 1);
        let now = crate::util::now_ms();
        let stamp = |ms: u64| {
            let secs = ms / 1000;
            let (h, m, s) = (secs % 86_400 / 3600, secs % 3600 / 60, secs % 60);
            let days = i64::try_from(secs / 86_400).expect("days") + 719_468;
            let era = days / 146_097;
            let doe = days - era * 146_097;
            let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
            let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
            let mp = (5 * doy + 2) / 153;
            let day = doy - (153 * mp + 2) / 5 + 1;
            let month = if mp < 10 { mp + 3 } else { mp - 9 };
            let year = yoe + era * 400 + i64::from(month <= 2);
            format!("{year:04}-{month:02}-{day:02}T{h:02}:{m:02}:{s:02}.{:03}Z", ms % 1000)
        };
        let reply = format!(
            r#"{{"type":"assistant","timestamp":"{}","message":{{"id":"m1","model":"x","content":[],"usage":{{"input_tokens":3,"output_tokens":512}}}}}}"#,
            stamp(now + 50)
        );
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new().append(true).open(&transcript).expect("open");
        writeln!(file, "{reply}").expect("append");
        let grown = next_snapshot_where(&rx, |s| s.sessions.first().is_some_and(|v| v.tokens_out == 512));
        assert_eq!(grown.sessions[0].phase, Phase::Thinking);
        let interrupt = format!(
            r#"{{"type":"user","timestamp":"{}","message":{{"content":[{{"type":"text","text":"[Request interrupted by user]"}}]}}}}"#,
            stamp(now + 400)
        );
        writeln!(file, "{interrupt}").expect("append");
        let paused = next_snapshot_where(&rx, |s| s.sessions.first().is_some_and(|v| v.phase == Phase::Paused));
        assert_eq!(paused.sessions[0].tokens_out, 512);
        drop(handle);
    }

    #[test]
    fn an_agent_reporting_to_the_feed_shows_up_without_any_connect() {
        use crate::engine::AlertKind;
        use crate::feed::FeedEvent;
        let dir = tempfile::tempdir().expect("tempdir");
        let (handle, rx, _dirs) = start(dir.path());
        let feed_dir = dir.path().join("agents");
        let report = |phase: Phase, detail: Option<&str>, summary: Option<&str>| {
            let event = FeedEvent {
                agent: "aider".into(),
                name: Some("Aider".into()),
                session: "s1".into(),
                at: Some(now_ms()),
                phase: Some(phase),
                tool: detail.map(|_| "shell".into()),
                detail: detail.map(str::to_owned),
                summary: summary.map(str::to_owned),
                cwd: Some(r"D:\work\dotDock".into()),
                pid: Some(std::process::id()),
                ..FeedEvent::default()
            };
            feed::append(&feed_dir, "aider-s1", &event).expect("append");
        };
        report(Phase::Running, Some("pytest -q"), None);
        let running = next_snapshot_where(&rx, |s| s.sessions.len() == 1);
        let view = &running.sessions[0];
        assert_eq!((view.agent, view.agent_label.as_str(), view.phase), (crate::phase::AgentKind::Other, "Aider", Phase::Running));
        assert_eq!((view.detail.as_deref(), view.project.as_str()), (Some("pytest -q"), "dotDock"));
        report(Phase::Done, None, Some("All tests pass"));
        let done = next_snapshot_where(&rx, |s| s.sessions.first().is_some_and(|v| v.phase == Phase::Done));
        assert_eq!(done.sessions[0].summary.as_deref(), Some("All tests pass"));
        let alert = std::iter::from_fn(|| rx.recv_timeout(Duration::from_millis(300)).ok()).find_map(|o| match o {
            Output::Alert(a) => Some(a),
            Output::Snapshot(_) => None,
        });
        assert_eq!(alert.map(|a| (a.kind, a.agent_label)), Some((AlertKind::Done, "Aider".to_owned())));
        drop(handle);
    }

    #[test]
    fn dismiss_and_removed_files_clear_the_island() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (handle, rx, dirs) = start(dir.path());
        write_event(&dirs, &hook_event("s1", "UserPromptSubmit", ""), Some(std::process::id()));
        next_snapshot_where(&rx, |s| s.sessions.len() == 1);
        handle.dismiss("s1");
        next_snapshot_where(&rx, |s| s.sessions.is_empty());
        write_event(&dirs, &hook_event("s2", "UserPromptSubmit", ""), Some(std::process::id()));
        next_snapshot_where(&rx, |s| s.sessions.len() == 1);
        std::fs::remove_file(state::file_for(&dirs.sessions_dir(), "s2")).expect("remove");
        next_snapshot_where(&rx, |s| s.sessions.is_empty());
        drop(handle);
    }

    #[test]
    fn codex_logs_are_followed_when_enabled() {
        let dir = tempfile::tempdir().expect("tempdir");
        let dirs = ClaudeDirs::at(dir.path().join(".claude"));
        std::fs::create_dir_all(dirs.config_dir()).expect("config dir");
        let codex_root = dir.path().join("codex-sessions");
        let log = codex_root
            .join("2026")
            .join("11")
            .join("19")
            .join("rollout-2026-11-19T10-00-00-01a04e65-47c8-70c1-b898-8d5452cb24b0.jsonl");
        std::fs::create_dir_all(log.parent().expect("parent")).expect("mkdir");
        std::fs::write(&log, "").expect("log");
        let (out_tx, out_rx) = channel();
        let sink_tx = Mutex::new(out_tx);
        let handle = spawn(
            MonitorConfig {
                dirs,
                codex_root: Some(codex_root),
                codex_enabled: true,
                feed_dir: dir.path().join("agents"),
                engine: EngineConfig::default(),
            },
            move |o| {
                let _ = lock(&sink_tx).send(o);
            },
        )
        .expect("spawn");
        let now = now_ms();
        let started = format!(
            r#"{{"timestamp":"2026-11-19T04:30:01.000Z","type":"event_msg","payload":{{"type":"task_started","started_at":{}}}}}"#,
            now / 1000
        );
        std::thread::sleep(Duration::from_millis(100));
        std::fs::write(&log, format!("{started}\n")).expect("append");
        // The fixture timestamp is old, so the session is stale-on-arrival by design; what matters is the watcher
        // delivered the line and the engine hid it rather than showing history.
        std::thread::sleep(Duration::from_millis(400));
        assert!(lock(&handle.engine).state_of("codex-01a04e65-47c8-70c1-b898-8d5452cb24b0").is_some());
        handle.set_codex_enabled(false);
        std::thread::sleep(Duration::from_millis(300));
        assert!(lock(&handle.engine).state_of("codex-01a04e65-47c8-70c1-b898-8d5452cb24b0").is_none());
        drop((handle, out_rx));
    }
}

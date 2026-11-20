//! One object the app holds: the monitor, the settings, Connect/Disconnect and the chimes, behind the calls
//! the island window makes. The host (the Tauri core) only forwards events to the window and shows toasts.

use crate::agents::{self, AgentConnectError, AgentHomes, AgentState, Connectable};
use crate::connect::{ConnectError, Connector, Status};
use crate::engine::{Alert, AlertKind, Snapshot};
use crate::focus::FocusOutcome;
use crate::hookexe::{self, InstallError};
use crate::monitor::{self, MonitorConfig, MonitorError, MonitorHandle, Output};
use crate::paths::{codex_sessions_dir, ClaudeDirs};
use crate::problem::ProblemKind;
use crate::settings::{self, IslandSettings};
use crate::sound::{self, Chime};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

#[derive(Debug, thiserror::Error)]
pub enum ServiceError {
    #[error(transparent)]
    Monitor(#[from] MonitorError),
    #[error(transparent)]
    Connect(#[from] ConnectError),
    #[error(transparent)]
    Install(#[from] InstallError),
    #[error(transparent)]
    Settings(#[from] settings::SettingsError),
    #[error(transparent)]
    Agent(#[from] AgentConnectError),
    #[error("Claude Code is not installed on this machine")]
    NoClaude,
}

/// Folder name, under the app's data folder, where agents report what they are doing.
const FEED_DIR: &str = "agents";

/// What the app gives the service.
pub struct ServiceConfig {
    pub dirs: ClaudeDirs,
    /// The app's data folder; settings, the agent feed and the installed hook copy live under it.
    pub data_dir: PathBuf,
    /// The bundled `dotdock-island-hook.exe`, usually next to the app's own executable.
    pub hook_source: PathBuf,
    /// Where GitHub Copilot CLI and OpenCode keep their configuration, for Connect.
    pub homes: AgentHomes,
}

/// Receives what the service produces. Implemented by the Tauri core: emit events, show toasts.
pub trait Host: Send + Sync + 'static {
    fn snapshot(&self, snapshot: Snapshot);
    fn settings(&self, settings: IslandSettings);
    /// Called only when the user has notifications on. Show a system toast; there is no click callback on Windows.
    fn notify(&self, copy: NotificationCopy, alert: Alert);
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct NotificationCopy {
    pub title: String,
    pub body: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectionState {
    NoClaude,
    Disconnected,
    Connected,
    Outdated,
    HookMissing,
}

/// One agent that Connect sets up with a file of its own.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AgentConnection {
    pub agent: Connectable,
    pub state: AgentState,
    /// The file Connect writes, empty when the machine has no folder to look in.
    pub file: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub state: ConnectionState,
    pub settings_path: String,
    pub codex_available: bool,
    pub agents: Vec<AgentConnection>,
    /// The folder any agent can report to (`docs/ISLAND_PROTOCOL.md`).
    pub feed_dir: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialState {
    pub snapshot: Snapshot,
    pub settings: IslandSettings,
    pub connection: ConnectionStatus,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// Copy for a system toast. Short, specific, no exclamation marks.
pub fn notification_copy(alert: &Alert) -> NotificationCopy {
    let agent = alert.agent_label.as_str();
    let (title, body) = match alert.kind {
        AlertKind::Done => (format!("{agent} finished"), alert.text.clone().unwrap_or_else(|| alert.project.clone())),
        AlertKind::Waiting => {
            (format!("{agent} needs you"), alert.text.clone().unwrap_or_else(|| alert.project.clone()))
        }
        AlertKind::Limit => {
            let resets = alert.problem.as_ref().and_then(|p| p.resets.as_deref()).map(|r| format!("Resets {r}"));
            (format!("{agent} reached a limit"), resets.unwrap_or_else(|| alert.project.clone()))
        }
        AlertKind::Error => {
            let body = match alert.problem.as_ref().map(|p| p.kind) {
                Some(ProblemKind::Login) if alert.agent == crate::phase::AgentKind::Claude => {
                    "Signed out. Run /login in the terminal.".to_owned()
                }
                Some(ProblemKind::Login) => format!("Signed out. Sign in to {agent} again."),
                Some(ProblemKind::Connection) => "Cannot reach the API. Check the connection and resend.".to_owned(),
                _ => alert.problem.as_ref().map_or_else(|| alert.project.clone(), |p| p.message.clone()),
            };
            (format!("{agent} stopped"), body)
        }
    };
    NotificationCopy { title: format!("{title} · {}", alert.project), body }
}

fn chime_for(kind: AlertKind) -> Chime {
    match kind {
        AlertKind::Done => Chime::Done,
        AlertKind::Waiting => Chime::Attention,
        AlertKind::Limit | AlertKind::Error => Chime::Problem,
    }
}

pub struct IslandService {
    cfg: ServiceConfig,
    monitor: MonitorHandle,
    settings: Arc<Mutex<IslandSettings>>,
    host: Arc<dyn Host>,
    latest: Arc<Mutex<Option<Snapshot>>>,
}

impl IslandService {
    /// Loads settings, starts watching, and quietly repoints the hook entries if the app moved since Connect.
    pub fn start(cfg: ServiceConfig, host: impl Host) -> Result<Self, ServiceError> {
        let host: Arc<dyn Host> = Arc::new(host);
        let settings_file = cfg.data_dir.join(settings::FILE_NAME);
        let current = IslandSettings::load(&settings_file);
        let settings = Arc::new(Mutex::new(current.clone()));
        let latest: Arc<Mutex<Option<Snapshot>>> = Arc::new(Mutex::new(None));

        let sink_host = Arc::clone(&host);
        let sink_settings = Arc::clone(&settings);
        let sink_latest = Arc::clone(&latest);
        let monitor = monitor::spawn(
            MonitorConfig {
                dirs: cfg.dirs.clone(),
                codex_root: codex_sessions_dir(),
                codex_enabled: current.codex,
                feed_dir: cfg.data_dir.join(FEED_DIR),
                engine: current.engine_config(),
            },
            move |output| match output {
                Output::Snapshot(snapshot) => {
                    *lock(&sink_latest) = Some(snapshot.clone());
                    sink_host.snapshot(snapshot);
                }
                Output::Alert(alert) => {
                    let s = lock(&sink_settings).clone();
                    if !s.enabled {
                        return;
                    }
                    if s.sound {
                        sound::play(chime_for(alert.kind), s.volume);
                    }
                    if s.notify {
                        sink_host.notify(notification_copy(&alert), alert);
                    }
                }
            },
        )?;
        let service = Self { cfg, monitor, settings, host, latest };
        service.repair_if_moved();
        Ok(service)
    }

    fn connector(&self, hook: PathBuf) -> Connector {
        Connector::new(self.cfg.dirs.settings_file(), hook)
    }

    fn hook_dir(&self) -> PathBuf {
        self.cfg.data_dir.join("island")
    }

    /// The installed copy the settings should point at, installing it first if needed.
    fn install_hook(&self) -> Result<PathBuf, ServiceError> {
        Ok(hookexe::install(&self.cfg.hook_source, &self.hook_dir())?)
    }

    fn feed_dir(&self) -> PathBuf {
        self.cfg.data_dir.join(FEED_DIR)
    }

    /// The file Connect writes for `agent` when the hook program is `hook`.
    fn agent_file(&self, agent: Connectable, hook: &std::path::Path) -> Option<agents::OwnedFile> {
        agents::owned_file(agent, &self.cfg.homes, hook, &self.feed_dir())
    }

    fn agent_state(&self, agent: Connectable) -> AgentState {
        self.agent_file(agent, &self.current_hook()).map_or(AgentState::NotFound, |file| file.status())
    }

    /// Entries and files that are ours but point at a vanished or older hook or feed folder are repointed.
    /// Nothing happens for agents that were never connected.
    fn repair_if_moved(&self) {
        let ours = |state: AgentState| matches!(state, AgentState::Connected | AgentState::Outdated | AgentState::HookMissing);
        let claude = matches!(
            self.connector(self.current_hook()).status(),
            Ok(Status::Connected | Status::Outdated | Status::HookMissing)
        );
        let connected: Vec<Connectable> = Connectable::ALL.into_iter().filter(|a| ours(self.agent_state(*a))).collect();
        if !claude && connected.is_empty() {
            return;
        }
        let Ok(hook) = self.install_hook() else { return };
        let claude_ok = !claude || self.connector(hook.clone()).connect().is_ok();
        let agents_ok = connected.iter().all(|a| self.agent_file(*a, &hook).is_some_and(|file| file.connect().is_ok()));
        if claude_ok && agents_ok {
            hookexe::remove_old(&self.hook_dir(), &hook);
        }
    }

    /// The installed copy if there is one, otherwise where it would go. Enough to ask the settings file
    /// "are our entries there?" without installing anything.
    fn current_hook(&self) -> PathBuf {
        let dir = self.hook_dir();
        let installed = std::fs::read_dir(&dir).ok().and_then(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|e| e.path())
                .find(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(crate::connect::HOOK_MARKER)))
        });
        installed.unwrap_or_else(|| dir.join(format!("{}.exe", crate::connect::HOOK_MARKER)))
    }

    pub fn connection(&self) -> ConnectionStatus {
        let status = self.connector(self.current_hook()).status().unwrap_or(Status::Disconnected);
        ConnectionStatus {
            state: match status {
                Status::NoClaude => ConnectionState::NoClaude,
                Status::Disconnected => ConnectionState::Disconnected,
                Status::Connected => ConnectionState::Connected,
                Status::Outdated => ConnectionState::Outdated,
                Status::HookMissing => ConnectionState::HookMissing,
            },
            settings_path: self.cfg.dirs.settings_file().to_string_lossy().into_owned(),
            codex_available: codex_sessions_dir().is_some_and(|d| d.exists()),
            agents: Connectable::ALL
                .into_iter()
                .map(|agent| AgentConnection {
                    agent,
                    state: self.agent_state(agent),
                    file: self
                        .agent_file(agent, &self.current_hook())
                        .map_or_else(String::new, |file| file.path().to_string_lossy().into_owned()),
                })
                .collect(),
            feed_dir: self.feed_dir().to_string_lossy().into_owned(),
        }
    }

    /// Writes the file that makes `agent` report to the island. Never edits a file of the agent's.
    pub fn connect_agent(&self, agent: Connectable) -> Result<ConnectionStatus, ServiceError> {
        let hook = self.install_hook()?;
        let file = self.agent_file(agent, &hook).ok_or(AgentConnectError::NotInstalled(agent.label()))?;
        file.connect()?;
        self.monitor.rescan();
        Ok(self.connection())
    }

    /// Deletes that file again.
    pub fn disconnect_agent(&self, agent: Connectable) -> Result<ConnectionStatus, ServiceError> {
        if let Some(file) = self.agent_file(agent, &self.current_hook()) {
            file.disconnect()?;
        }
        Ok(self.connection())
    }

    pub fn connect(&self) -> Result<ConnectionStatus, ServiceError> {
        if !self.cfg.dirs.config_dir().exists() {
            return Err(ServiceError::NoClaude);
        }
        let hook = self.install_hook()?;
        self.connector(hook.clone()).connect()?;
        hookexe::remove_old(&self.hook_dir(), &hook);
        self.monitor.rescan();
        Ok(self.connection())
    }

    pub fn disconnect(&self) -> Result<ConnectionStatus, ServiceError> {
        self.connector(self.current_hook()).disconnect()?;
        Ok(self.connection())
    }

    pub fn settings(&self) -> IslandSettings {
        lock(&self.settings).clone()
    }

    pub fn set_settings(&self, new: IslandSettings) -> Result<IslandSettings, ServiceError> {
        let new = new.sanitized();
        new.save(&self.cfg.data_dir.join(settings::FILE_NAME))?;
        *lock(&self.settings) = new.clone();
        self.monitor.set_engine_config(new.engine_config());
        self.monitor.set_codex_enabled(new.codex);
        self.host.settings(new.clone());
        Ok(new)
    }

    /// Everything the window needs on first paint.
    pub fn initial_state(&self) -> InitialState {
        let snapshot = lock(&self.latest).clone().unwrap_or(Snapshot { seq: 0, sessions: Vec::new(), current: None });
        InitialState { snapshot, settings: self.settings(), connection: self.connection() }
    }

    pub fn dismiss(&self, id: &str) {
        self.monitor.dismiss(id);
    }

    pub fn focus(&self, id: &str) -> FocusOutcome {
        self.monitor.focus(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::AlertKind;
    use crate::phase::AgentKind;
    use crate::problem::Problem;

    #[derive(Default)]
    struct Recorder {
        snapshots: Mutex<Vec<Snapshot>>,
        settings: Mutex<Vec<IslandSettings>>,
    }

    impl Host for Arc<Recorder> {
        fn snapshot(&self, snapshot: Snapshot) {
            lock(&self.snapshots).push(snapshot);
        }
        fn settings(&self, settings: IslandSettings) {
            lock(&self.settings).push(settings);
        }
        fn notify(&self, _copy: NotificationCopy, _alert: Alert) {}
    }

    fn alert(kind: AlertKind, text: Option<&str>, problem: Option<Problem>) -> Alert {
        Alert {
            session_id: "s".into(),
            agent: AgentKind::Claude,
            agent_label: "Claude Code".into(),
            kind,
            project: "dotDock".into(),
            text: text.map(str::to_owned),
            problem,
        }
    }

    #[test]
    fn toast_copy_is_short_and_specific() {
        let done = notification_copy(&alert(AlertKind::Done, Some("Fixed the header layout."), None));
        assert_eq!(
            (done.title.as_str(), done.body.as_str()),
            ("Claude Code finished · dotDock", "Fixed the header layout.")
        );
        let waiting =
            notification_copy(&alert(AlertKind::Waiting, Some("Claude needs your permission to use Bash"), None));
        assert_eq!(waiting.title, "Claude Code needs you · dotDock");
        let limit =
            Problem { kind: ProblemKind::UsageLimit, message: "Session limit".into(), resets: Some("1:50pm".into()) };
        assert_eq!(notification_copy(&alert(AlertKind::Limit, None, Some(limit))).body, "Resets 1:50pm");
        let login = Problem { kind: ProblemKind::Login, message: "Signed out".into(), resets: None };
        assert_eq!(
            notification_copy(&alert(AlertKind::Error, None, Some(login))).body,
            "Signed out. Run /login in the terminal."
        );
        let bare = notification_copy(&alert(AlertKind::Done, None, None));
        assert_eq!(bare.body, "dotDock");
    }

    #[test]
    fn toast_copy_names_the_agent_that_spoke() {
        let mut copilot = alert(AlertKind::Done, Some("Added the dock tests."), None);
        copilot.agent = AgentKind::Copilot;
        copilot.agent_label = "GitHub Copilot CLI".into();
        assert_eq!(notification_copy(&copilot).title, "GitHub Copilot CLI finished · dotDock");
        let login = Problem { kind: ProblemKind::Login, message: "Signed out".into(), resets: None };
        let mut aider = alert(AlertKind::Error, None, Some(login));
        aider.agent = AgentKind::Other;
        aider.agent_label = "Aider".into();
        assert_eq!(notification_copy(&aider).body, "Signed out. Sign in to Aider again.");
    }

    fn fixture() -> (tempfile::TempDir, ServiceConfig) {
        let dir = tempfile::tempdir().expect("tempdir");
        let dirs = ClaudeDirs::at(dir.path().join(".claude"));
        std::fs::create_dir_all(dirs.config_dir()).expect("config");
        std::fs::write(dirs.settings_file(), br#"{"theme":"dark"}"#).expect("settings");
        let hook_source = dir.path().join("app").join("dotdock-island-hook.exe");
        std::fs::create_dir_all(hook_source.parent().expect("parent")).expect("app dir");
        std::fs::write(&hook_source, b"hook v1").expect("hook");
        let homes = AgentHomes { copilot: Some(dir.path().join(".copilot")), opencode: Some(dir.path().join("opencode")) };
        for home in [&homes.copilot, &homes.opencode].into_iter().flatten() {
            std::fs::create_dir_all(home).expect("agent home");
        }
        let cfg = ServiceConfig { dirs, data_dir: dir.path().join("data"), hook_source, homes };
        (dir, cfg)
    }

    #[test]
    fn connect_disconnect_and_settings_round_trip_in_a_temp_profile() {
        let (_dir, cfg) = fixture();
        let settings_file = cfg.dirs.settings_file();
        let data_dir = cfg.data_dir.clone();
        let recorder = Arc::new(Recorder::default());
        let service = IslandService::start(cfg, Arc::clone(&recorder)).expect("start");
        assert_eq!(service.connection().state, ConnectionState::Disconnected);
        assert_eq!(service.connect().expect("connect").state, ConnectionState::Connected);
        assert!(std::fs::read_to_string(&settings_file).expect("read").contains("dotdock-island-hook-"));
        assert_eq!(service.connect().expect("again").state, ConnectionState::Connected);
        assert_eq!(service.disconnect().expect("disconnect").state, ConnectionState::Disconnected);
        assert_eq!(std::fs::read_to_string(&settings_file).expect("read").trim(), "{\n  \"theme\": \"dark\"\n}");

        let changed = IslandSettings { scale: 1.2, sound: false, ..service.settings() };
        assert_eq!(service.set_settings(changed).expect("save").scale, 1.2);
        assert_eq!(IslandSettings::load(&data_dir.join(settings::FILE_NAME)).scale, 1.2);
        assert_eq!(lock(&recorder.settings).last().map(|s| s.scale), Some(1.2));
        assert_eq!(service.initial_state().settings.scale, 1.2);
    }

    #[test]
    fn an_updated_hook_is_repointed_at_startup_for_connected_users_only() {
        let (_dir, cfg) = fixture();
        let (source, dirs, data, homes) =
            (cfg.hook_source.clone(), cfg.dirs.clone(), cfg.data_dir.clone(), cfg.homes.clone());
        let first = IslandService::start(cfg, Arc::new(Recorder::default())).expect("start");
        first.connect().expect("connect");
        drop(first);
        std::fs::write(&source, b"hook v2, rebuilt").expect("update");
        let second = IslandService::start(
            ServiceConfig { dirs: dirs.clone(), data_dir: data.clone(), hook_source: source.clone(), homes: homes.clone() },
            Arc::new(Recorder::default()),
        )
        .expect("restart");
        assert_eq!(second.connection().state, ConnectionState::Connected, "repointed without asking");
        let copies = std::fs::read_dir(data.join("island")).expect("list").count();
        assert_eq!(copies, 1, "the superseded copy is gone");
        second.disconnect().expect("disconnect");
        drop(second);
        std::fs::write(&source, b"hook v3, rebuilt again").expect("update");
        let third = IslandService::start(
            ServiceConfig { dirs, data_dir: data, hook_source: source, homes },
            Arc::new(Recorder::default()),
        )
        .expect("third");
        assert_eq!(
            third.connection().state,
            ConnectionState::Disconnected,
            "a user who disconnected stays disconnected"
        );
    }

    #[test]
    fn copilot_and_opencode_connect_and_disconnect_without_touching_any_file_of_theirs() {
        let (dir, cfg) = fixture();
        let (copilot, opencode) = (cfg.homes.copilot.clone().expect("copilot"), cfg.homes.opencode.clone().expect("opencode"));
        std::fs::write(copilot.join("config.json"), b"{ \"model\": \"gpt\" }\r\n").expect("copilot config");
        std::fs::write(opencode.join("opencode.json"), b"{ \"model\": \"x\" }\r\n").expect("opencode config");
        let claude_settings = cfg.dirs.settings_file();
        let claude_before = std::fs::read(&claude_settings).expect("claude settings");
        let service = IslandService::start(cfg, Arc::new(Recorder::default())).expect("start");

        let states = |s: &ConnectionStatus| s.agents.iter().map(|a| (a.agent, a.state)).collect::<Vec<_>>();
        assert_eq!(
            states(&service.connection()),
            vec![(Connectable::Copilot, AgentState::Disconnected), (Connectable::OpenCode, AgentState::Disconnected)]
        );
        let status = service.connect_agent(Connectable::Copilot).expect("connect copilot");
        assert_eq!(states(&status)[0], (Connectable::Copilot, AgentState::Connected));
        assert!(copilot.join("hooks").join("dotdock-island.json").is_file());
        let status = service.connect_agent(Connectable::OpenCode).expect("connect opencode");
        assert_eq!(states(&status)[1], (Connectable::OpenCode, AgentState::Connected));
        assert!(opencode.join("plugins").join("dotdock-island.js").is_file());
        assert!(status.feed_dir.ends_with("agents"));
        assert_eq!(std::fs::read(&claude_settings).expect("claude settings"), claude_before, "Claude Code's settings are not part of this");

        service.disconnect_agent(Connectable::Copilot).expect("disconnect copilot");
        let status = service.disconnect_agent(Connectable::OpenCode).expect("disconnect opencode");
        assert_eq!(states(&status), vec![(Connectable::Copilot, AgentState::Disconnected), (Connectable::OpenCode, AgentState::Disconnected)]);
        assert_eq!(std::fs::read(copilot.join("config.json")).expect("read"), b"{ \"model\": \"gpt\" }\r\n");
        assert_eq!(std::fs::read(opencode.join("opencode.json")).expect("read"), b"{ \"model\": \"x\" }\r\n");
        assert!(!copilot.join("hooks").join("dotdock-island.json").exists() && !opencode.join("plugins").join("dotdock-island.js").exists());
        drop(dir);
    }

    #[test]
    fn connected_agents_are_repointed_after_an_update_and_disconnected_ones_stay_alone() {
        let (_dir, cfg) = fixture();
        let (source, dirs, data, homes) = (cfg.hook_source.clone(), cfg.dirs.clone(), cfg.data_dir.clone(), cfg.homes.clone());
        let first = IslandService::start(cfg, Arc::new(Recorder::default())).expect("start");
        first.connect_agent(Connectable::Copilot).expect("connect");
        drop(first);
        std::fs::write(&source, b"hook v2, rebuilt").expect("update");
        let second = IslandService::start(
            ServiceConfig { dirs, data_dir: data, hook_source: source, homes },
            Arc::new(Recorder::default()),
        )
        .expect("restart");
        let state = |agent| second.connection().agents.into_iter().find(|a| a.agent == agent).map(|a| a.state);
        assert_eq!(state(Connectable::Copilot), Some(AgentState::Connected), "repointed at the new hook program");
        assert_eq!(state(Connectable::OpenCode), Some(AgentState::Disconnected), "never connected, never touched");
    }

    #[test]
    fn an_agent_that_is_not_installed_cannot_be_connected() {
        let dir = tempfile::tempdir().expect("tempdir");
        let hook = dir.path().join("hook.exe");
        std::fs::write(&hook, b"x").expect("hook");
        let cfg = ServiceConfig {
            dirs: ClaudeDirs::at(dir.path().join("none")),
            data_dir: dir.path().join("data"),
            hook_source: hook,
            homes: AgentHomes { copilot: Some(dir.path().join("no-copilot")), opencode: None },
        };
        let service = IslandService::start(cfg, Arc::new(Recorder::default())).expect("start");
        assert!(matches!(service.connect_agent(Connectable::Copilot), Err(ServiceError::Agent(AgentConnectError::NotInstalled(_)))));
        assert!(matches!(service.connect_agent(Connectable::OpenCode), Err(ServiceError::Agent(AgentConnectError::NotInstalled(_)))));
        assert!(service.connection().agents.iter().all(|a| a.state == AgentState::NotFound));
        assert!(!dir.path().join("no-copilot").exists());
    }

    #[test]
    fn connect_refuses_without_a_claude_folder() {
        let dir = tempfile::tempdir().expect("tempdir");
        let hook = dir.path().join("hook.exe");
        std::fs::write(&hook, b"x").expect("hook");
        let cfg = ServiceConfig {
            dirs: ClaudeDirs::at(dir.path().join("none")),
            data_dir: dir.path().join("data"),
            hook_source: hook,
            homes: AgentHomes::default(),
        };
        let service = IslandService::start(cfg, Arc::new(Recorder::default())).expect("start");
        assert!(matches!(service.connect(), Err(ServiceError::NoClaude)));
        assert_eq!(service.connection().state, ConnectionState::NoClaude);
    }
}

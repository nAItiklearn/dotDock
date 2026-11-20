//! Connect / Disconnect for the agents that get one file of ours inside their own configuration folder:
//! GitHub Copilot CLI (a hooks file) and OpenCode (a plugin file).
//!
//! Both are reversible by construction. The file has a name only the island uses, Connect writes it atomically
//! and Disconnect deletes it; no file of the agent or the user is ever edited, so the folder is exactly as it
//! was before Connect. Claude Code is different (its settings file is shared) and is handled by `connect`.

use crate::connect::command_for;
use crate::copilot;
use crate::paths;
use crate::util::write_atomic;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

/// `<copilot home>\hooks\dotdock-island.json`
const COPILOT_HOOKS_FILE: &str = "dotdock-island.json";
/// `<opencode config>\plugins\dotdock-island.js`
const OPENCODE_PLUGIN_FILE: &str = "dotdock-island.js";
/// Copilot waits this long for a hook before it carries on; the hook itself takes a few milliseconds.
const HOOK_TIMEOUT_SECS: u64 = 5;
/// The plugin's source. `__SPOOL_DIR__` becomes the feed folder as a JSON string.
const OPENCODE_PLUGIN: &str = include_str!("../assets/opencode-plugin.js");
const SPOOL_PLACEHOLDER: &str = "__SPOOL_DIR__";

/// The agents Connect can set up.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Connectable {
    Copilot,
    OpenCode,
}

impl Connectable {
    pub const ALL: [Connectable; 2] = [Connectable::Copilot, Connectable::OpenCode];

    pub fn label(self) -> &'static str {
        match self {
            Connectable::Copilot => "GitHub Copilot CLI",
            Connectable::OpenCode => "OpenCode",
        }
    }
}

/// Where each agent keeps its configuration. `None` when the machine has no home folder to look in.
#[derive(Clone, Debug, Default)]
pub struct AgentHomes {
    pub copilot: Option<PathBuf>,
    pub opencode: Option<PathBuf>,
}

impl AgentHomes {
    pub fn from_env() -> Self {
        Self { copilot: paths::copilot_home(), opencode: paths::opencode_config_dir() }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentState {
    /// The agent's configuration folder does not exist: it is not installed, or never ran.
    NotFound,
    Disconnected,
    Connected,
    /// Our file is there but differs from what Connect would write now (the app moved or updated).
    Outdated,
    /// Our file is there but the hook program it runs is gone.
    HookMissing,
}

#[derive(Debug, thiserror::Error)]
pub enum AgentConnectError {
    #[error("{0} was not found on this machine")]
    NotInstalled(&'static str),
    #[error("the hook executable does not exist: {0}")]
    HookMissing(PathBuf),
    #[error("{path}: {source}")]
    Io { path: PathBuf, source: std::io::Error },
}

/// One file the island owns inside an agent's configuration folder.
pub struct OwnedFile {
    agent: &'static str,
    /// The agent's configuration folder; it must exist for the agent to count as installed.
    root: PathBuf,
    path: PathBuf,
    content: String,
    /// A program the file runs, which must exist for the file to work.
    requires: Option<PathBuf>,
}

impl OwnedFile {
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn status(&self) -> AgentState {
        if !self.root.is_dir() {
            return AgentState::NotFound;
        }
        match std::fs::read(&self.path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => AgentState::Disconnected,
            Ok(bytes) if bytes == self.content.as_bytes() => {
                if self.requires.as_ref().is_none_or(|exe| exe.is_file()) {
                    AgentState::Connected
                } else {
                    AgentState::HookMissing
                }
            }
            _ => AgentState::Outdated,
        }
    }

    pub fn connect(&self) -> Result<(), AgentConnectError> {
        if !self.root.is_dir() {
            return Err(AgentConnectError::NotInstalled(self.agent));
        }
        if let Some(exe) = self.requires.as_ref().filter(|exe| !exe.is_file()) {
            return Err(AgentConnectError::HookMissing(exe.clone()));
        }
        write_atomic(&self.path, self.content.as_bytes())
            .map_err(|source| AgentConnectError::Io { path: self.path.clone(), source })
    }

    /// Deletes the file. Nothing else is touched, and a file that is already gone is not an error.
    pub fn disconnect(&self) -> Result<(), AgentConnectError> {
        match std::fs::remove_file(&self.path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                Err(AgentConnectError::Io { path: self.path.clone(), source: e })
            }
            _ => Ok(()),
        }
    }
}

/// The hooks file for Copilot CLI: one `exec` entry per event, so no shell starts and the event name travels
/// on the command line (Copilot's native payload does not repeat it).
fn copilot_hooks(hook: &Path, spool: &Path) -> String {
    let entry = |event: &str| {
        json!([{
            "type": "command",
            "exec": command_for(hook),
            "args": ["--agent", copilot::AGENT, "--event", event, "--spool", command_for(spool)],
            "timeoutSec": HOOK_TIMEOUT_SECS,
        }])
    };
    let hooks: Map<String, Value> = copilot::EVENTS.iter().map(|event| ((*event).to_owned(), entry(event))).collect();
    let mut text = serde_json::to_string_pretty(&json!({ "version": 1, "hooks": hooks })).unwrap_or_default();
    text.push('\n');
    text
}

fn opencode_plugin(spool: &Path) -> String {
    let literal = serde_json::to_string(&command_for(spool)).unwrap_or_default();
    OPENCODE_PLUGIN.replace(SPOOL_PLACEHOLDER, &literal)
}

/// The file Connect writes for `agent`. `hook` is the installed hook executable (used by Copilot) and `spool`
/// the feed folder both agents report to.
pub fn owned_file(agent: Connectable, homes: &AgentHomes, hook: &Path, spool: &Path) -> Option<OwnedFile> {
    match agent {
        Connectable::Copilot => {
            let root = homes.copilot.clone()?;
            Some(OwnedFile {
                agent: agent.label(),
                path: root.join("hooks").join(COPILOT_HOOKS_FILE),
                content: copilot_hooks(hook, spool),
                requires: Some(hook.to_owned()),
                root,
            })
        }
        Connectable::OpenCode => {
            let root = homes.opencode.clone()?;
            Some(OwnedFile {
                agent: agent.label(),
                path: root.join("plugins").join(OPENCODE_PLUGIN_FILE),
                content: opencode_plugin(spool),
                requires: None,
                root,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        _dir: tempfile::TempDir,
        homes: AgentHomes,
        hook: PathBuf,
        spool: PathBuf,
    }

    fn fixture() -> Fixture {
        let dir = tempfile::tempdir().expect("tempdir");
        let homes =
            AgentHomes { copilot: Some(dir.path().join(".copilot")), opencode: Some(dir.path().join("opencode")) };
        for home in [&homes.copilot, &homes.opencode].into_iter().flatten() {
            std::fs::create_dir_all(home).expect("home");
        }
        let hook = dir.path().join("data").join("island").join("dotdock-island-hook-abc123.exe");
        std::fs::create_dir_all(hook.parent().expect("parent")).expect("hook dir");
        std::fs::write(&hook, b"exe").expect("hook");
        let spool = dir.path().join("data").join("agents");
        Fixture { _dir: dir, homes, hook, spool }
    }

    fn file(f: &Fixture, agent: Connectable) -> OwnedFile {
        owned_file(agent, &f.homes, &f.hook, &f.spool).expect("file")
    }

    fn snapshot(root: &Path) -> Vec<(PathBuf, Vec<u8>)> {
        fn walk(dir: &Path, out: &mut Vec<(PathBuf, Vec<u8>)>) {
            let mut entries: Vec<_> = std::fs::read_dir(dir).expect("list").filter_map(Result::ok).collect();
            entries.sort_by_key(std::fs::DirEntry::path);
            for entry in entries {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, out);
                } else {
                    out.push((path.clone(), std::fs::read(&path).expect("read")));
                }
            }
        }
        let mut out = Vec::new();
        walk(root, &mut out);
        out
    }

    #[test]
    fn copilot_hooks_register_every_event_with_exec_and_arguments() {
        let f = fixture();
        let doc: Value = serde_json::from_str(&copilot_hooks(&f.hook, &f.spool)).expect("json");
        assert_eq!(doc["version"], 1);
        let hooks = doc["hooks"].as_object().expect("hooks");
        assert_eq!(hooks.len(), copilot::EVENTS.len());
        for event in copilot::EVENTS {
            let entry = &hooks[event][0];
            assert_eq!(entry["type"], "command");
            assert!(entry["exec"]
                .as_str()
                .is_some_and(|p| p.ends_with("dotdock-island-hook-abc123.exe") && !p.contains('\\')));
            let args: Vec<&str> = entry["args"].as_array().expect("args").iter().filter_map(Value::as_str).collect();
            assert_eq!(&args[..4], ["--agent", "copilot", "--event", event]);
            assert_eq!(args[4], "--spool");
            assert!(
                entry.get("bash").is_none() && entry.get("powershell").is_none(),
                "exec is never mixed with shell fields"
            );
            assert_eq!(entry["timeoutSec"], HOOK_TIMEOUT_SECS);
        }
    }

    #[test]
    fn the_opencode_plugin_carries_the_feed_folder_as_a_string_literal() {
        let f = fixture();
        let source = opencode_plugin(&f.spool);
        assert!(!source.contains(SPOOL_PLACEHOLDER));
        let literal = serde_json::to_string(&command_for(&f.spool)).expect("json");
        assert!(source.contains(&format!("const SPOOL_DIR = {literal};")));
        assert!(source.contains("export default"));
    }

    #[test]
    fn each_agent_goes_through_disconnected_connected_disconnected() {
        let f = fixture();
        for agent in Connectable::ALL {
            let file = file(&f, agent);
            assert_eq!(file.status(), AgentState::Disconnected);
            file.connect().expect("connect");
            assert_eq!(file.status(), AgentState::Connected);
            file.connect().expect("connecting twice changes nothing");
            assert_eq!(file.status(), AgentState::Connected);
            file.disconnect().expect("disconnect");
            assert_eq!(file.status(), AgentState::Disconnected);
            file.disconnect().expect("disconnecting twice is fine");
        }
    }

    #[test]
    fn disconnect_leaves_every_other_file_exactly_as_it_was() {
        let f = fixture();
        let copilot = f.homes.copilot.clone().expect("copilot home");
        std::fs::write(copilot.join("config.json"), br#"{"trusted_folders":["D:\\work"]}"#).expect("config");
        std::fs::create_dir_all(copilot.join("hooks")).expect("hooks dir");
        std::fs::write(copilot.join("hooks").join("mine.json"), b"{\n  \"version\": 1, \"hooks\": {}\r\n}")
            .expect("user hook");
        let opencode = f.homes.opencode.clone().expect("opencode home");
        std::fs::write(opencode.join("opencode.json"), b"{ \"model\": \"x\" }\r\n").expect("opencode config");
        let before = (snapshot(&copilot), snapshot(&opencode));
        for agent in Connectable::ALL {
            let file = file(&f, agent);
            file.connect().expect("connect");
            file.disconnect().expect("disconnect");
        }
        assert_eq!(before.0, snapshot(&copilot), "Copilot's folder is byte for byte what it was");
        let after_opencode = snapshot(&opencode);
        assert_eq!(before.1, after_opencode, "OpenCode's folder is byte for byte what it was");
    }

    #[test]
    fn a_moved_app_or_an_old_plugin_shows_as_outdated_until_reconnected() {
        let f = fixture();
        let old = file(&f, Connectable::OpenCode);
        old.connect().expect("connect");
        let moved =
            owned_file(Connectable::OpenCode, &f.homes, &f.hook, &f._dir.path().join("elsewhere")).expect("file");
        assert_eq!(moved.status(), AgentState::Outdated);
        moved.connect().expect("reconnect");
        assert_eq!(moved.status(), AgentState::Connected);
        assert_eq!(old.status(), AgentState::Outdated);
    }

    #[test]
    fn a_missing_hook_program_is_reported_and_refused() {
        let f = fixture();
        let hooks = file(&f, Connectable::Copilot);
        hooks.connect().expect("connect");
        std::fs::remove_file(&f.hook).expect("remove hook");
        assert_eq!(hooks.status(), AgentState::HookMissing);
        assert!(matches!(hooks.connect(), Err(AgentConnectError::HookMissing(_))));
    }

    #[test]
    fn an_agent_that_is_not_installed_is_not_found_and_nothing_is_created() {
        let dir = tempfile::tempdir().expect("tempdir");
        let hook = dir.path().join("hook.exe");
        std::fs::write(&hook, b"exe").expect("hook");
        let homes = AgentHomes { copilot: Some(dir.path().join("no-copilot")), opencode: None };
        let copilot = owned_file(Connectable::Copilot, &homes, &hook, dir.path()).expect("file");
        assert_eq!(copilot.status(), AgentState::NotFound);
        assert!(matches!(copilot.connect(), Err(AgentConnectError::NotInstalled("GitHub Copilot CLI"))));
        assert!(!dir.path().join("no-copilot").exists(), "Connect never creates an agent's home folder");
        assert!(owned_file(Connectable::OpenCode, &homes, &hook, dir.path()).is_none());
    }

    #[test]
    fn the_agent_names_match_the_wire_protocol() {
        assert_eq!(serde_json::to_string(&Connectable::OpenCode).expect("json"), "\"opencode\"");
        assert_eq!(serde_json::from_str::<Connectable>("\"copilot\"").expect("copilot"), Connectable::Copilot);
        assert!(serde_json::from_str::<Connectable>("\"claude\"").is_err());
        assert_eq!(serde_json::to_string(&AgentState::HookMissing).expect("json"), "\"hook-missing\"");
        assert_eq!(serde_json::to_string(&AgentState::NotFound).expect("json"), "\"not-found\"");
    }
}

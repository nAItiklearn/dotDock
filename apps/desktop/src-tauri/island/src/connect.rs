//! Connect / Disconnect: registers the island's hook in Claude Code's user settings file, reversibly.
//!
//! Rules this module keeps:
//! - Only the user-level `settings.json` is ever touched, never a project's.
//! - Only entries whose command is our hook executable are added, replaced or removed.
//! - The file is parsed first; if it is not valid JSON or has an unexpected shape, nothing is written.
//! - Every write is preceded by a timestamped backup (the newest five are kept) and is atomic.
//! - Connecting twice is a no-op, and Disconnect after Connect restores the original document.

use crate::util::{now_ms, write_atomic};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

/// File-name prefix that identifies our hook executable in a command.
pub const HOOK_MARKER: &str = "dotdock-island-hook";
/// Events the island listens to, with the matcher each needs.
const EVENTS: [(&str, Option<&str>); 8] = [
    ("UserPromptSubmit", None),
    ("PreToolUse", None),
    ("PostToolUse", None),
    ("PostToolUseFailure", None),
    ("Stop", None),
    ("StopFailure", None),
    ("SessionEnd", None),
    ("Notification", Some("idle_prompt|permission_prompt|agent_needs_input")),
];
const BACKUPS_KEPT: usize = 5;
const BACKUP_INFIX: &str = ".dotdock-island-backup-";
const WRITE_ATTEMPTS: u32 = 3;

#[derive(Debug, thiserror::Error)]
pub enum ConnectError {
    #[error("{path}: {source}")]
    Io { path: PathBuf, source: std::io::Error },
    #[error("{0} is not valid JSON; it was left untouched")]
    InvalidJson(PathBuf),
    #[error("{0} has an unexpected shape ({1}); it was left untouched")]
    UnexpectedShape(PathBuf, &'static str),
    #[error("the hook executable does not exist: {0}")]
    HookMissing(PathBuf),
    #[error("settings.json kept changing while it was being edited; try again")]
    ConcurrentEdit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    /// No Claude Code configuration folder exists on this machine.
    NoClaude,
    Disconnected,
    Connected,
    /// Connected, but the entries point somewhere else or some are missing (the app moved or updated).
    Outdated,
    /// Our entries exist but the executable they name is gone.
    HookMissing,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Change {
    Unchanged,
    /// The file was rewritten; the backup of its previous contents, when there was one.
    Written {
        backup: Option<PathBuf>,
    },
}

/// Edits one settings file for one hook executable.
pub struct Connector {
    settings: PathBuf,
    hook: PathBuf,
}

fn io_err(path: &Path) -> impl FnOnce(std::io::Error) -> ConnectError + '_ {
    move |source| ConnectError::Io { path: path.to_owned(), source }
}

/// Forward slashes work in a Windows exec-form command and survive JSON without escaping.
pub(crate) fn command_for(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn is_ours(entry: &Value) -> bool {
    let Some(command) = entry.get("command").and_then(Value::as_str) else { return false };
    let name = command.rsplit(['/', '\\']).next().unwrap_or(command).to_lowercase();
    name.starts_with(HOOK_MARKER)
}

fn desired_entry(hook: &Path) -> Value {
    json!({ "type": "command", "command": command_for(hook), "args": [], "async": true })
}

fn desired_group(hook: &Path, matcher: Option<&str>) -> Value {
    let mut group = Map::new();
    if let Some(m) = matcher {
        group.insert("matcher".into(), json!(m));
    }
    group.insert("hooks".into(), json!([desired_entry(hook)]));
    Value::Object(group)
}

/// A group already registers exactly our desired entry (and nothing else that matters).
fn group_is_desired(group: &Value, hook: &Path, matcher: Option<&str>) -> bool {
    group.get("matcher").and_then(Value::as_str) == matcher
        && group
            .get("hooks")
            .and_then(Value::as_array)
            .is_some_and(|hooks| hooks.iter().any(|h| *h == desired_entry(hook)))
}

/// Removes our entries from one event's groups, dropping groups that become empty. Returns whether anything changed.
fn strip_ours(groups: &mut Vec<Value>) -> bool {
    let before = groups.clone();
    for group in groups.iter_mut() {
        if let Some(hooks) = group.get_mut("hooks").and_then(Value::as_array_mut) {
            hooks.retain(|h| !is_ours(h));
        }
    }
    groups.retain(|g| g.get("hooks").and_then(Value::as_array).is_none_or(|h| !h.is_empty()));
    *groups != before
}

impl Connector {
    pub fn new(settings_file: impl Into<PathBuf>, hook_exe: impl Into<PathBuf>) -> Self {
        Self { settings: settings_file.into(), hook: hook_exe.into() }
    }

    pub fn settings_path(&self) -> &Path {
        &self.settings
    }

    /// Follows a symlinked settings file (dotfile managers) so the link itself is not replaced.
    fn target(&self) -> PathBuf {
        std::fs::canonicalize(&self.settings).map(|p| strip_verbatim(&p)).unwrap_or_else(|_| self.settings.clone())
    }

    fn read(&self) -> Result<(Value, Option<Vec<u8>>), ConnectError> {
        let path = self.target();
        match std::fs::read(&path) {
            Ok(bytes) => {
                let body = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
                let value: Value = serde_json::from_slice(body).map_err(|_| ConnectError::InvalidJson(path.clone()))?;
                if !value.is_object() {
                    return Err(ConnectError::UnexpectedShape(path, "top level is not an object"));
                }
                Ok((value, Some(bytes)))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok((json!({}), None)),
            Err(source) => Err(ConnectError::Io { path, source }),
        }
    }

    pub fn status(&self) -> Result<Status, ConnectError> {
        let Some(config_dir) = self.settings.parent() else { return Ok(Status::NoClaude) };
        if !config_dir.exists() {
            return Ok(Status::NoClaude);
        }
        let (settings, _) = self.read()?;
        let hooks = settings.get("hooks").and_then(Value::as_object);
        let mut found = 0;
        let mut current = 0;
        for (event, matcher) in EVENTS {
            let groups =
                hooks.and_then(|h| h.get(event)).and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
            if groups.iter().any(|g| g.get("hooks").and_then(Value::as_array).is_some_and(|hs| hs.iter().any(is_ours)))
            {
                found += 1;
            }
            if groups.iter().any(|g| group_is_desired(g, &self.hook, matcher)) {
                current += 1;
            }
        }
        Ok(match (found, current) {
            (0, _) => Status::Disconnected,
            (_, c) if c == EVENTS.len() && self.hook.exists() => Status::Connected,
            (_, c) if c == EVENTS.len() => Status::HookMissing,
            _ => Status::Outdated,
        })
    }

    pub fn connect(&self) -> Result<Change, ConnectError> {
        if !self.hook.is_file() {
            return Err(ConnectError::HookMissing(self.hook.clone()));
        }
        self.edit(|settings, hook| {
            let root = settings.as_object_mut().ok_or("top level is not an object")?;
            let hooks = root.entry("hooks").or_insert_with(|| json!({}));
            let hooks = hooks.as_object_mut().ok_or("\"hooks\" is not an object")?;
            for (event, matcher) in EVENTS {
                let groups = hooks.entry(event).or_insert_with(|| json!([]));
                let groups = groups.as_array_mut().ok_or("a hook event is not an array")?;
                if groups
                    .iter()
                    .filter(|g| g.get("hooks").and_then(Value::as_array).is_some_and(|hs| hs.iter().any(is_ours)))
                    .count()
                    == 1
                    && groups.iter().any(|g| group_is_desired(g, hook, matcher))
                {
                    continue;
                }
                strip_ours(groups);
                groups.push(desired_group(hook, matcher));
            }
            Ok(())
        })
    }

    pub fn disconnect(&self) -> Result<Change, ConnectError> {
        self.edit(|settings, _| {
            let Some(hooks) = settings.get_mut("hooks") else { return Ok(()) };
            let hooks = hooks.as_object_mut().ok_or("\"hooks\" is not an object")?;
            let mut touched = false;
            for groups in hooks.values_mut() {
                if let Some(groups) = groups.as_array_mut() {
                    touched |= strip_ours(groups);
                }
            }
            hooks.retain(|_, v| v.as_array().is_none_or(|a| !a.is_empty()));
            if touched && hooks.is_empty() {
                if let Some(root) = settings.as_object_mut() {
                    root.remove("hooks");
                }
            }
            Ok(())
        })
    }

    /// Read, modify, back up, write; retried if the file changes underneath us.
    fn edit(&self, change: impl Fn(&mut Value, &Path) -> Result<(), &'static str>) -> Result<Change, ConnectError> {
        let path = self.target();
        for _ in 0..WRITE_ATTEMPTS {
            let (original, original_bytes) = self.read()?;
            let mut edited = original.clone();
            change(&mut edited, &self.hook).map_err(|why| ConnectError::UnexpectedShape(path.clone(), why))?;
            if edited == original {
                return Ok(Change::Unchanged);
            }
            let crlf = original_bytes.as_deref().is_some_and(|b| b.windows(2).any(|w| w == b"\r\n"));
            let mut text =
                serde_json::to_string_pretty(&edited).map_err(|_| ConnectError::InvalidJson(path.clone()))?;
            text.push('\n');
            if crlf {
                text = text.replace('\n', "\r\n");
            }
            let backup =
                original_bytes.as_deref().map(|bytes| write_backup(&path, bytes)).transpose().map_err(io_err(&path))?;
            // Someone else (Claude Code itself) may have written the file since we read it.
            let unchanged_since_read = match (&original_bytes, std::fs::read(&path)) {
                (Some(before), Ok(now)) => *before == now,
                (None, Err(e)) => e.kind() == std::io::ErrorKind::NotFound,
                _ => false,
            };
            if !unchanged_since_read {
                continue;
            }
            write_atomic(&path, text.as_bytes()).map_err(io_err(&path))?;
            return Ok(Change::Written { backup });
        }
        Err(ConnectError::ConcurrentEdit)
    }
}

/// `\\?\C:\x` from canonicalize is valid but ugly in messages and breaks some tools.
fn strip_verbatim(path: &Path) -> PathBuf {
    path.to_str().and_then(|s| s.strip_prefix(r"\\?\")).map_or_else(|| path.to_owned(), PathBuf::from)
}

fn write_backup(settings: &Path, bytes: &[u8]) -> std::io::Result<PathBuf> {
    let name = settings.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let stamp = now_ms();
    let backup = settings.with_file_name(format!("{name}{BACKUP_INFIX}{stamp}"));
    write_atomic(&backup, bytes)?;
    let mut all: Vec<PathBuf> = std::fs::read_dir(settings.parent().unwrap_or(Path::new(".")))?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(&format!("{name}{BACKUP_INFIX}"))))
        .collect();
    all.sort();
    let excess = all.len().saturating_sub(BACKUPS_KEPT);
    for old in all.into_iter().take(excess) {
        let _ = std::fs::remove_file(old);
    }
    Ok(backup)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        _dir: tempfile::TempDir,
        settings: PathBuf,
        hook: PathBuf,
    }

    fn fixture(initial: Option<&str>) -> Fixture {
        let dir = tempfile::tempdir().expect("tempdir");
        let config = dir.path().join(".claude");
        std::fs::create_dir_all(&config).expect("mkdir");
        let hook = dir.path().join("bin").join("dotdock-island-hook-abc123.exe");
        std::fs::create_dir_all(hook.parent().expect("parent")).expect("mkdir bin");
        std::fs::write(&hook, b"exe").expect("hook");
        let settings = config.join("settings.json");
        if let Some(text) = initial {
            std::fs::write(&settings, text).expect("settings");
        }
        Fixture { _dir: dir, settings, hook }
    }

    fn connector(f: &Fixture) -> Connector {
        Connector::new(&f.settings, &f.hook)
    }

    fn read_json(f: &Fixture) -> Value {
        serde_json::from_slice(&std::fs::read(&f.settings).expect("read")).expect("json")
    }

    const USER_SETTINGS: &str = r#"{
  "permissions": { "allow": ["Bash(git status)"] },
  "theme": "dark",
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "rtk hook claude" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "notify-send done" } ] }
    ]
  }
}"#;

    #[test]
    fn connect_adds_our_entries_and_keeps_everything_else() {
        let f = fixture(Some(USER_SETTINGS));
        let before = read_json(&f);
        assert!(matches!(connector(&f).connect().expect("connect"), Change::Written { backup: Some(_) }));
        let after = read_json(&f);
        assert_eq!(after["permissions"], before["permissions"]);
        assert_eq!(after["theme"], before["theme"]);
        let pre = after["hooks"]["PreToolUse"].as_array().expect("array");
        assert_eq!(pre[0], before["hooks"]["PreToolUse"][0], "the user's own hook is untouched and first");
        assert_eq!(pre.len(), 2);
        let ours = &pre[1]["hooks"][0];
        assert_eq!(ours["type"], "command");
        assert!(ours["command"].as_str().expect("command").ends_with("bin/dotdock-island-hook-abc123.exe"));
        assert_eq!(ours["args"], json!([]));
        assert_eq!(ours["async"], true);
        assert_eq!(after["hooks"]["Stop"].as_array().expect("stop").len(), 2);
        for (event, _) in EVENTS {
            assert!(after["hooks"][event].is_array(), "{event} registered");
        }
        assert_eq!(after["hooks"]["Notification"][0]["matcher"], "idle_prompt|permission_prompt|agent_needs_input");
        assert_eq!(connector(&f).status().expect("status"), Status::Connected);
    }

    #[test]
    fn connect_is_idempotent_and_does_not_touch_the_file_twice() {
        let f = fixture(Some(USER_SETTINGS));
        connector(&f).connect().expect("first");
        let once = std::fs::read(&f.settings).expect("read");
        assert_eq!(connector(&f).connect().expect("second"), Change::Unchanged);
        assert_eq!(std::fs::read(&f.settings).expect("read"), once);
    }

    #[test]
    fn disconnect_restores_the_original_document() {
        let f = fixture(Some(USER_SETTINGS));
        let original = read_json(&f);
        connector(&f).connect().expect("connect");
        assert!(matches!(connector(&f).disconnect().expect("disconnect"), Change::Written { .. }));
        assert_eq!(read_json(&f), original);
        assert_eq!(connector(&f).status().expect("status"), Status::Disconnected);
        assert_eq!(connector(&f).disconnect().expect("again"), Change::Unchanged);
    }

    #[test]
    fn disconnect_removes_the_hooks_key_it_created_and_the_file_it_created_stays_valid() {
        let f = fixture(Some(r#"{"theme":"dark"}"#));
        connector(&f).connect().expect("connect");
        connector(&f).disconnect().expect("disconnect");
        assert_eq!(read_json(&f), json!({"theme":"dark"}));
        let fresh = fixture(None);
        assert_eq!(connector(&fresh).status().expect("status"), Status::Disconnected);
        assert!(matches!(connector(&fresh).connect().expect("connect"), Change::Written { backup: None }));
        assert_eq!(connector(&fresh).status().expect("status"), Status::Connected);
    }

    #[test]
    fn a_moved_app_is_outdated_and_connect_repoints_without_duplicates() {
        let f = fixture(Some(USER_SETTINGS));
        connector(&f).connect().expect("connect");
        let moved = f.hook.with_file_name("dotdock-island-hook-def456.exe");
        std::fs::write(&moved, b"exe").expect("new hook");
        let c = Connector::new(&f.settings, &moved);
        assert_eq!(c.status().expect("status"), Status::Outdated);
        c.connect().expect("repoint");
        assert_eq!(c.status().expect("status"), Status::Connected);
        let stop = read_json(&f)["hooks"]["Stop"].clone();
        assert_eq!(stop.as_array().expect("stop").len(), 2, "still one user hook and one of ours");
        std::fs::remove_file(&moved).expect("remove");
        assert_eq!(c.status().expect("status"), Status::HookMissing);
    }

    #[test]
    fn invalid_or_odd_files_are_never_written() {
        let f = fixture(Some("{ this is not json"));
        assert!(matches!(connector(&f).connect(), Err(ConnectError::InvalidJson(_))));
        assert_eq!(std::fs::read_to_string(&f.settings).expect("read"), "{ this is not json");
        let g = fixture(Some(r#"{"hooks":{"Stop":"nope"}}"#));
        assert!(matches!(connector(&g).connect(), Err(ConnectError::UnexpectedShape(..))));
        let h = fixture(Some("[1,2]"));
        assert!(matches!(connector(&h).connect(), Err(ConnectError::UnexpectedShape(..))));
        let backups = std::fs::read_dir(f.settings.parent().expect("parent")).expect("list").count();
        assert_eq!(backups, 1, "no backup is made when nothing is written");
    }

    #[test]
    fn a_missing_hook_executable_is_refused() {
        let f = fixture(Some("{}"));
        let c = Connector::new(&f.settings, f.hook.with_file_name("nope.exe"));
        assert!(matches!(c.connect(), Err(ConnectError::HookMissing(_))));
    }

    #[test]
    fn backups_hold_the_previous_bytes_and_are_pruned() {
        let f = fixture(Some(USER_SETTINGS));
        let c = connector(&f);
        let Change::Written { backup: Some(first) } = c.connect().expect("connect") else {
            panic!("expected a backup")
        };
        assert_eq!(std::fs::read_to_string(first).expect("backup"), USER_SETTINGS);
        for _ in 0..8 {
            std::thread::sleep(std::time::Duration::from_millis(2));
            c.disconnect().expect("disconnect");
            std::thread::sleep(std::time::Duration::from_millis(2));
            c.connect().expect("connect");
        }
        let kept = std::fs::read_dir(f.settings.parent().expect("parent"))
            .expect("list")
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().contains(BACKUP_INFIX))
            .count();
        assert_eq!(kept, BACKUPS_KEPT);
    }

    #[test]
    fn byte_order_marks_and_crlf_are_handled() {
        let f = fixture(None);
        std::fs::write(&f.settings, b"\xEF\xBB\xBF{\r\n  \"theme\": \"dark\"\r\n}\r\n").expect("write");
        connector(&f).connect().expect("connect");
        let bytes = std::fs::read(&f.settings).expect("read");
        assert!(!bytes.starts_with(b"\xEF\xBB\xBF"));
        assert!(bytes.windows(2).any(|w| w == b"\r\n"), "line endings stay CRLF");
        assert_eq!(read_json(&f)["theme"], "dark");
    }

    #[test]
    fn a_missing_claude_folder_means_no_claude() {
        let dir = tempfile::tempdir().expect("tempdir");
        let c = Connector::new(dir.path().join("nope").join("settings.json"), dir.path().join("hook.exe"));
        assert_eq!(c.status().expect("status"), Status::NoClaude);
    }

    #[test]
    fn marker_matches_only_our_executable_names() {
        assert!(is_ours(&json!({"command": "C:/x/dotdock-island-hook-abc.exe"})));
        assert!(is_ours(&json!({"command": r"C:\x\DotDock-Island-Hook.exe"})));
        assert!(!is_ours(&json!({"command": "C:/dotdock-island-hook/other-tool.exe"})));
        assert!(!is_ours(&json!({"command": "rtk hook claude"})));
        assert!(!is_ours(&json!({"type": "command"})));
    }
}

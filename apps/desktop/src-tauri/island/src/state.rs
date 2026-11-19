//! The per-session state file the hook writes and the app reads.
//!
//! One `<session id>.json` per session under `<config>\tools\island\sessions\`, written atomically.
//! Times are epoch milliseconds, `seq` is an epoch-nanosecond stamp that orders concurrent hook runs.

use crate::phase::{AgentKind, Phase};
use crate::problem::Problem;
use crate::util::{sanitize_id, write_atomic};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};

pub const SCHEMA: u32 = 1;
/// State files are tiny; anything larger is not ours.
const MAX_STATE_BYTES: u64 = 256 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum StateError {
    #[error("state file: {0}")]
    Io(#[from] std::io::Error),
    #[error("state file is not valid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("state file is too large")]
    TooLarge,
}

/// Where to find the terminal the session runs in, captured from the hook's environment.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TerminalHint {
    /// `TERM_PROGRAM` (for example `vscode`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub program: Option<String>,
    /// Windows Terminal tab id (`WT_SESSION`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wt_session: Option<String>,
}

impl TerminalHint {
    pub fn is_empty(&self) -> bool {
        self.program.is_none() && self.wt_session.is_none()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionState {
    pub schema: u32,
    pub agent: AgentKind,
    pub session_id: String,
    pub phase: Phase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub project: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Absolute path of the Claude Code transcript.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript: Option<String>,
    /// When the current turn began (epoch ms).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_started_at: Option<u64>,
    /// Transcript size when the turn began; token counting starts reading here.
    pub turn_offset: u64,
    /// First line of the final reply, set by `Stop`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<Problem>,
    /// Output tokens this turn when the source reports them directly (Codex); Claude's are read from the transcript.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_out: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<u64>,
    /// Epoch ms of the last change.
    pub updated_at: u64,
    /// Epoch ns of the last change; a hook run with an older stamp never overwrites a newer state.
    pub seq: u64,
    /// Process id of Claude Code (the hook's parent) and its creation time as a Windows FILETIME.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid_start: Option<u64>,
    #[serde(skip_serializing_if = "TerminalHint::is_empty")]
    pub terminal: TerminalHint,
}

impl SessionState {
    pub fn new(agent: AgentKind, session_id: &str) -> Self {
        Self { schema: SCHEMA, agent, session_id: sanitize_id(session_id), ..Self::default() }
    }

    /// `<sessions dir>\<session id>.json`
    pub fn path_in(&self, sessions_dir: &Path) -> PathBuf {
        file_for(sessions_dir, &self.session_id)
    }

    pub fn write(&self, sessions_dir: &Path) -> Result<(), StateError> {
        let bytes = serde_json::to_vec(self)?;
        write_atomic(&self.path_in(sessions_dir), &bytes)?;
        Ok(())
    }

    /// Reads one state file. The session id always comes from the file name, so a hand-edited body cannot
    /// make two files claim the same session.
    pub fn read(path: &Path) -> Result<Self, StateError> {
        let file = std::fs::File::open(path)?;
        let mut bytes = Vec::new();
        file.take(MAX_STATE_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_STATE_BYTES {
            return Err(StateError::TooLarge);
        }
        let body = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
        let mut state: SessionState = serde_json::from_slice(body)?;
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            state.session_id = sanitize_id(stem);
        }
        Ok(state)
    }
}

pub fn file_for(sessions_dir: &Path, session_id: &str) -> PathBuf {
    sessions_dir.join(format!("{}.json", sanitize_id(session_id)))
}

/// True for `<id>.json` files; temp files (`.x.tmp`) and the lock file do not count.
pub fn is_state_file(path: &Path) -> bool {
    path.extension().is_some_and(|e| e == "json")
        && path.file_name().and_then(|n| n.to_str()).is_some_and(|n| !n.starts_with('.'))
}

/// Every readable state file in the folder. Unreadable or foreign files are skipped, never fatal.
pub fn read_all(sessions_dir: &Path) -> Vec<SessionState> {
    let Ok(entries) = std::fs::read_dir(sessions_dir) else { return Vec::new() };
    entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| is_state_file(p))
        .filter_map(|p| SessionState::read(&p).ok())
        .filter(|s| !s.session_id.is_empty())
        .collect()
}

/// Removes state files not touched since `before_ms` (epoch ms). Returns how many were deleted.
pub fn prune(sessions_dir: &Path, before_ms: u64) -> usize {
    let Ok(entries) = std::fs::read_dir(sessions_dir) else { return 0 };
    let mut removed = 0;
    for path in entries.filter_map(Result::ok).map(|e| e.path()).filter(|p| is_state_file(p)) {
        let stale = SessionState::read(&path).map(|s| s.updated_at < before_ms).unwrap_or(true);
        if stale && std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> SessionState {
        let mut s = SessionState::new(AgentKind::Claude, "abc-123");
        s.phase = Phase::Reading;
        s.tool = Some("Read".into());
        s.detail = Some("lib.rs".into());
        s.project = "dotDock".into();
        s.updated_at = 1_000;
        s.seq = 5;
        s
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = tempfile::tempdir().expect("tempdir");
        let state = sample();
        state.write(dir.path()).expect("write");
        let back = SessionState::read(&dir.path().join("abc-123.json")).expect("read");
        assert_eq!(back, state);
    }

    #[test]
    fn serialises_camel_case_and_omits_empty_fields() {
        let json = serde_json::to_string(&sample()).expect("json");
        assert!(json.contains("\"sessionId\":\"abc-123\""));
        assert!(json.contains("\"phase\":\"reading\""));
        assert!(!json.contains("summary"));
        assert!(!json.contains("terminal"));
    }

    #[test]
    fn reads_older_files_with_missing_fields() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("old.json");
        std::fs::write(&path, br#"{"phase":"thinking","updatedAt":42}"#).expect("write");
        let state = SessionState::read(&path).expect("read");
        assert_eq!(state.phase, Phase::Thinking);
        assert_eq!(state.session_id, "old");
        assert_eq!(state.updated_at, 42);
    }

    #[test]
    fn tolerates_a_byte_order_mark_and_rejects_garbage() {
        let dir = tempfile::tempdir().expect("tempdir");
        let bom = dir.path().join("bom.json");
        std::fs::write(&bom, b"\xEF\xBB\xBF{\"phase\":\"done\"}").expect("write");
        assert_eq!(SessionState::read(&bom).expect("read").phase, Phase::Done);
        let bad = dir.path().join("bad.json");
        std::fs::write(&bad, b"{not json").expect("write");
        assert!(matches!(SessionState::read(&bad), Err(StateError::Json(_))));
    }

    #[test]
    fn file_name_wins_over_body_session_id() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("real.json");
        std::fs::write(&path, br#"{"sessionId":"../hacked","phase":"idle"}"#).expect("write");
        assert_eq!(SessionState::read(&path).expect("read").session_id, "real");
    }

    #[test]
    fn read_all_skips_temp_and_foreign_files_and_prune_removes_old_ones() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut fresh = sample();
        fresh.session_id = "fresh".into();
        fresh.updated_at = 10_000;
        fresh.write(dir.path()).expect("write fresh");
        let mut old = sample();
        old.session_id = "old".into();
        old.updated_at = 100;
        old.write(dir.path()).expect("write old");
        std::fs::write(dir.path().join(".fresh.json.1.0.tmp"), b"{}").expect("tmp");
        std::fs::write(dir.path().join("notes.txt"), b"x").expect("txt");
        assert_eq!(read_all(dir.path()).len(), 2);
        assert_eq!(prune(dir.path(), 5_000), 1);
        let left = read_all(dir.path());
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].session_id, "fresh");
    }

    #[test]
    fn oversized_files_are_refused() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("big.json");
        std::fs::write(&path, vec![b' '; (MAX_STATE_BYTES + 10) as usize]).expect("write");
        assert!(matches!(SessionState::read(&path), Err(StateError::TooLarge)));
    }
}

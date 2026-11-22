//! Reads Codex's local rollout logs (`~\.codex\sessions\YYYY\MM\DD\rollout-*.jsonl`) and turns each into a
//! session state, without hooks and without spending tokens.
//!
//! The log format is not a public contract (it changed shape between Codex releases), so every line that is not
//! understood is skipped. Checked against logs written by Codex on Windows in 2026: `session_meta`,
//! `turn_context`, `event_msg` (`task_started`, `token_count`, `task_complete`, `item_completed`) and
//! `response_item` (`reasoning`, `custom_tool_call`, `custom_tool_call_output`).

use crate::describe::describe_codex;
use crate::hook::{first_line, project_name};
use crate::phase::{AgentKind, Phase};
use crate::problem::{classify, ProblemKind};
use crate::state::SessionState;
use crate::tail::Tail;
use crate::transcript::parse_iso_ms;
use crate::util::clip;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// First read of a large log starts this far from the end: enough to find the current turn's `task_started`.
const FIRST_READ_WINDOW: u64 = 400 * 1024;
/// How many of the newest day folders are searched for live logs at startup.
const DAY_FOLDERS: usize = 3;
const TITLE_LIMIT: usize = 40;
const SESSION_ID_LEN: usize = 36;

#[derive(Debug, Deserialize)]
struct Line {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    timestamp: String,
    #[serde(default)]
    payload: Value,
}

/// A change worth publishing, plus whether the turn just finished (for the done chime).
#[derive(Debug, PartialEq)]
pub struct CodexUpdate {
    pub state: SessionState,
    pub finished: bool,
}

struct Thread {
    tail: Tail,
    state: SessionState,
    started: bool,
    turn_base_tokens: u64,
    total_tokens: u64,
}

/// Incremental reader over all Codex logs currently being written.
pub struct CodexReader {
    threads: HashMap<PathBuf, Thread>,
}

/// Sub-agent logs have an underscore in the file name and are folded into their parent task.
pub fn is_rollout(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with("rollout-") && n.ends_with(".jsonl") && !n.contains('_'))
}

fn session_id_for(path: &Path) -> String {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("rollout");
    let tail: String = stem.chars().rev().take(SESSION_ID_LEN).collect::<Vec<_>>().into_iter().rev().collect();
    format!("codex-{}", crate::util::sanitize_id(&tail))
}

/// Rollout files changed within `window`, looked up in the newest day folders only.
pub fn recent_files(root: &Path, window: Duration) -> Vec<PathBuf> {
    fn newest_dirs(dir: &Path) -> Vec<PathBuf> {
        let mut dirs: Vec<PathBuf> = std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        dirs.sort();
        dirs.reverse();
        dirs
    }
    let now = SystemTime::now();
    let mut days = Vec::new();
    'outer: for year in newest_dirs(root) {
        for month in newest_dirs(&year) {
            for day in newest_dirs(&month) {
                days.push(day);
                if days.len() >= DAY_FOLDERS {
                    break 'outer;
                }
            }
        }
    }
    days.iter()
        .flat_map(|day| std::fs::read_dir(day).into_iter().flatten().filter_map(Result::ok))
        .map(|e| e.path())
        .filter(|p| is_rollout(p))
        .filter(|p| {
            std::fs::metadata(p)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| now.duration_since(t).ok())
                .is_some_and(|age| age <= window)
        })
        .collect()
}

impl CodexReader {
    pub fn new() -> Self {
        Self { threads: HashMap::new() }
    }

    /// Reads whatever was appended to `path` since last time. `None` when nothing visible changed.
    pub fn read(&mut self, path: &Path) -> Option<CodexUpdate> {
        if !is_rollout(path) {
            return None;
        }
        let thread = self.threads.entry(path.to_owned()).or_insert_with(|| Thread {
            tail: Tail::new(),
            state: SessionState::new(AgentKind::Codex, &session_id_for(path)),
            started: false,
            turn_base_tokens: 0,
            total_tokens: 0,
        });
        let lines = thread.tail.read_lines(path, FIRST_READ_WINDOW)?;
        let before = thread.state.clone();
        let mut finished = false;
        for line in &lines {
            let Ok(line) = serde_json::from_str::<Line>(line) else { continue };
            finished |= thread.apply(&line);
        }
        (thread.started && thread.state != before).then(|| CodexUpdate { state: thread.state.clone(), finished })
    }

    pub fn forget(&mut self, path: &Path) {
        self.threads.remove(path);
    }
}

impl Default for CodexReader {
    fn default() -> Self {
        Self::new()
    }
}

impl Thread {
    fn set(&mut self, phase: Phase, tool: Option<String>, detail: Option<String>) {
        self.state.phase = phase;
        self.state.tool = tool;
        self.state.detail = detail;
        self.state.summary = None;
        self.state.problem = None;
    }

    /// Applies one log line; returns true when it completed the turn.
    fn apply(&mut self, line: &Line) -> bool {
        let at = parse_iso_ms(&line.timestamp);
        let payload = &line.payload;
        let kind = payload.get("type").and_then(Value::as_str).unwrap_or("");
        let str_of = |key: &str| payload.get(key).and_then(Value::as_str);
        let mut finished = false;
        match (line.kind.as_str(), kind) {
            ("session_meta" | "turn_context", _) => {
                if let Some(cwd) = str_of("cwd") {
                    self.state.project = project_name(cwd);
                    self.state.cwd = Some(cwd.to_owned());
                }
            }
            ("event_msg", "task_started") => {
                self.started = true;
                let started_secs = payload.get("started_at").and_then(Value::as_u64);
                self.state.turn_started_at = started_secs.map(|s| s * 1000).or(at);
                self.turn_base_tokens = self.total_tokens;
                self.state.tokens_out = Some(0);
                self.set(Phase::Thinking, None, None);
            }
            ("event_msg", "item_completed") => {
                let item = payload.get("item");
                let is_user = item
                    .and_then(|i| i.get("type"))
                    .and_then(Value::as_str)
                    .is_some_and(|t| t.eq_ignore_ascii_case("usermessage"));
                if is_user && self.state.title.is_none() {
                    let text = item
                        .and_then(|i| i.get("content"))
                        .and_then(Value::as_array)
                        .and_then(|c| c.iter().find_map(|b| b.get("text")?.as_str()));
                    self.state.title = text.and_then(first_line).map(|t| clip(&t, TITLE_LIMIT));
                }
            }
            ("response_item", "reasoning") if self.started && self.state.phase != Phase::Thinking => {
                self.set(Phase::Thinking, None, None)
            }
            ("response_item", "custom_tool_call" | "function_call") if self.started => {
                let name = str_of("name").unwrap_or("");
                let input = str_of("input").or_else(|| str_of("arguments")).unwrap_or("");
                let described = describe_codex(name, input);
                self.set(described.phase, described.tool, described.detail);
            }
            ("response_item", "custom_tool_call_output" | "function_call_output") if self.started => {
                self.set(Phase::Thinking, None, None)
            }
            ("event_msg", "token_count") => {
                let total = payload.pointer("/info/total_token_usage/output_tokens").and_then(Value::as_u64);
                if let Some(total) = total {
                    self.total_tokens = total;
                    if self.started {
                        self.state.tokens_out = Some(total.saturating_sub(self.turn_base_tokens));
                    }
                }
                self.state.context = payload
                    .pointer("/info/last_token_usage/total_tokens")
                    .and_then(Value::as_u64)
                    .or(self.state.context);
            }
            ("event_msg", "exec_approval_request" | "apply_patch_approval_request") if self.started => {
                self.set(Phase::Waiting, None, None)
            }
            ("event_msg", "task_complete") if self.started => {
                let summary = str_of("last_agent_message").and_then(first_line);
                self.set(Phase::Done, None, None);
                self.state.summary = summary;
                finished = true;
            }
            ("event_msg", "turn_aborted") if self.started => self.set(Phase::Paused, None, None),
            ("event_msg", "error") if self.started => {
                let problem = classify("", str_of("message").unwrap_or(""));
                let phase = if problem.kind == ProblemKind::UsageLimit { Phase::Limit } else { Phase::Error };
                self.set(phase, None, None);
                self.state.problem = Some(problem);
            }
            _ => {}
        }
        if let Some(at) = at {
            self.state.updated_at = at;
            self.state.seq = at.saturating_mul(1_000_000);
        }
        finished
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const ID: &str = "01a04e65-47c8-70c1-b898-8d5452cb24b0";

    fn rollout_path(dir: &Path) -> PathBuf {
        dir.join("2026").join("11").join("19").join(format!("rollout-2026-11-19T10-00-00-{ID}.jsonl"))
    }

    fn append(path: &Path, lines: &[&str]) {
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path).expect("open");
        for line in lines {
            writeln!(file, "{line}").expect("write");
        }
    }

    const META: &str = r#"{"timestamp":"2026-11-19T04:30:00.000Z","type":"session_meta","payload":{"id":"x","cwd":"D:\\work\\dotDock"}}"#;
    const START: &str = r#"{"timestamp":"2026-11-19T04:30:01.000Z","type":"event_msg","payload":{"type":"task_started","turn_id":"t","started_at":1795062601}}"#;
    const USER: &str = r#"{"timestamp":"2026-11-19T04:30:02.000Z","type":"event_msg","payload":{"type":"item_completed","item":{"type":"UserMessage","content":[{"type":"input_text","text":"Fix the layout bug in the header"}]}}}"#;
    const THINK: &str = r#"{"timestamp":"2026-11-19T04:30:03.000Z","type":"response_item","payload":{"type":"reasoning","summary":[]}}"#;
    const TOOL: &str = r#"{"timestamp":"2026-11-19T04:30:04.000Z","type":"response_item","payload":{"type":"custom_tool_call","name":"exec","input":"const r = await tools.exec_command({\"cmd\":\"Get-Content -Raw src\\\\app.tsx\"});"}}"#;
    const OUT: &str = r#"{"timestamp":"2026-11-19T04:30:05.000Z","type":"response_item","payload":{"type":"custom_tool_call_output","output":[]}}"#;
    const TOKENS: &str = r#"{"timestamp":"2026-11-19T04:30:06.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"output_tokens":400},"last_token_usage":{"total_tokens":16043}}}}"#;
    const DONE: &str = r#"{"timestamp":"2026-11-19T04:30:09.000Z","type":"event_msg","payload":{"type":"task_complete","last_agent_message":"Fixed the header layout.\nDetails follow."}}"#;

    #[test]
    fn follows_a_turn_from_start_to_done() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = rollout_path(dir.path());
        let mut reader = CodexReader::new();
        append(&path, &[META, START, USER, THINK]);
        let update = reader.read(&path).expect("update");
        assert!(!update.finished);
        let s = &update.state;
        assert_eq!((s.agent, s.phase, s.project.as_str()), (AgentKind::Codex, Phase::Thinking, "dotDock"));
        assert_eq!(s.session_id, format!("codex-{ID}"));
        assert_eq!(s.title.as_deref(), Some("Fix the layout bug in the header"));
        assert_eq!(s.turn_started_at, Some(1_795_062_601_000));

        append(&path, &[TOOL]);
        let s = reader.read(&path).expect("tool").state;
        assert_eq!((s.phase, s.detail.as_deref()), (Phase::Reading, Some("app.tsx")));

        append(&path, &[OUT, TOKENS]);
        let s = reader.read(&path).expect("tokens").state;
        assert_eq!((s.phase, s.tokens_out, s.context), (Phase::Thinking, Some(400), Some(16_043)));

        append(&path, &[DONE]);
        let update = reader.read(&path).expect("done");
        assert!(update.finished);
        assert_eq!(
            (update.state.phase, update.state.summary.as_deref()),
            (Phase::Done, Some("Fixed the header layout."))
        );
        assert!(reader.read(&path).is_none(), "nothing new, nothing to publish");
    }

    #[test]
    fn tokens_are_counted_per_turn_not_per_session() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = rollout_path(dir.path());
        let mut reader = CodexReader::new();
        let second_start = r#"{"timestamp":"2026-11-19T04:31:00.000Z","type":"event_msg","payload":{"type":"task_started","started_at":1795062660}}"#;
        let second_tokens = r#"{"timestamp":"2026-11-19T04:31:05.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"output_tokens":450}}}}"#;
        append(&path, &[META, START, TOKENS, DONE, second_start, second_tokens]);
        let s = reader.read(&path).expect("update").state;
        assert_eq!(s.tokens_out, Some(50));
        assert_eq!(s.phase, Phase::Thinking);
    }

    #[test]
    fn aborts_errors_and_approvals_map_to_phases() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = rollout_path(dir.path());
        let mut reader = CodexReader::new();
        append(
            &path,
            &[
                META,
                START,
                r#"{"timestamp":"2026-11-19T04:30:03.000Z","type":"event_msg","payload":{"type":"exec_approval_request"}}"#,
            ],
        );
        assert_eq!(reader.read(&path).expect("waiting").state.phase, Phase::Waiting);
        append(
            &path,
            &[r#"{"timestamp":"2026-11-19T04:30:04.000Z","type":"event_msg","payload":{"type":"turn_aborted"}}"#],
        );
        assert_eq!(reader.read(&path).expect("paused").state.phase, Phase::Paused);
        append(
            &path,
            &[
                START,
                r#"{"timestamp":"2026-11-19T04:30:06.000Z","type":"event_msg","payload":{"type":"error","message":"You've hit your usage limit · resets 5pm"}}"#,
            ],
        );
        let s = reader.read(&path).expect("limit").state;
        assert_eq!(s.phase, Phase::Limit);
        assert_eq!(s.problem.expect("problem").kind, ProblemKind::UsageLimit);
    }

    #[test]
    fn activity_before_the_first_task_started_is_ignored() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = rollout_path(dir.path());
        let mut reader = CodexReader::new();
        append(&path, &[META, TOOL, OUT]);
        assert!(reader.read(&path).is_none());
    }

    #[test]
    fn half_written_and_unknown_lines_are_skipped() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = rollout_path(dir.path());
        let mut reader = CodexReader::new();
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        let half = &THINK[..THINK.len() / 2];
        std::fs::write(
            &path,
            format!("{META}\nnot json at all\n{{\"type\":\"future_thing\",\"payload\":{{}}}}\n{START}\n{half}"),
        )
        .expect("write");
        assert_eq!(reader.read(&path).expect("update").state.phase, Phase::Thinking);
        let mut file = std::fs::OpenOptions::new().append(true).open(&path).expect("open");
        writeln!(file, "{}", &THINK[THINK.len() / 2..]).expect("write rest");
        writeln!(file, "{TOOL}").expect("write tool");
        assert_eq!(reader.read(&path).expect("tool").state.phase, Phase::Reading);
    }

    #[test]
    fn only_main_rollout_files_count() {
        assert!(is_rollout(Path::new("rollout-2026-11-19T10-00-00-abc.jsonl")));
        assert!(!is_rollout(Path::new("rollout-2026-11-19T10-00-00-abc_sub1.jsonl")));
        assert!(!is_rollout(Path::new("notes.jsonl")));
    }

    #[test]
    fn recent_files_finds_only_fresh_rollouts_in_the_newest_days() {
        let dir = tempfile::tempdir().expect("tempdir");
        let fresh = rollout_path(dir.path());
        append(&fresh, &[META]);
        append(&dir.path().join("2026").join("11").join("19").join("rollout-x_sub.jsonl"), &[META]);
        let stale = dir.path().join("2025").join("01").join("01").join("rollout-old.jsonl");
        append(&stale, &[META]);
        let a_day_ago = SystemTime::now() - Duration::from_secs(86_400);
        std::fs::OpenOptions::new().write(true).open(&stale).expect("open").set_modified(a_day_ago).expect("set mtime");
        let found = recent_files(dir.path(), Duration::from_secs(600));
        assert_eq!(found, vec![fresh]);
    }
}

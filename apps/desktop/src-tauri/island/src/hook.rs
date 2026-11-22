//! The logic behind the `dotdock-island-hook` binary: one Claude Code hook event in, one state file out.
//!
//! Everything is a pure function of (previous state, event, environment) so it is fully unit-tested; the
//! binary only supplies the clock, the process facts and stdin. A hook must never slow down or fail Claude
//! Code, so every error path ends quietly.

use crate::describe::{describe_claude, ToolInput};
use crate::paths::ClaudeDirs;
use crate::phase::{AgentKind, Phase};
use crate::problem::{classify, ProblemKind};
use crate::process;
use crate::state::{SessionState, TerminalHint};
use crate::util::{basename, clip, now_ms, now_ns, sanitize_id};
use serde::de::IgnoredAny;
use serde::{Deserialize, Deserializer};
use std::io::Read;
use std::time::{Duration, Instant};

/// Longest stdin we read. A `Read` of a large file can produce a very large `tool_response`.
const MAX_STDIN_BYTES: u64 = 64 * 1024 * 1024;
const SUMMARY_LIMIT: usize = 120;
const NOTICE_LIMIT: usize = 80;
/// How long a hook waits for the per-folder lock before it writes anyway.
const LOCK_WAIT: Duration = Duration::from_millis(40);
const LOCK_FILE: &str = ".hook.lock";

/// Accepts a string and quietly turns any other JSON value into `None`, so one surprising field type in a
/// future Claude Code release cannot make the whole event unreadable.
pub(crate) fn lenient_string<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Value {
        Text(String),
        Other(IgnoredAny),
    }
    Ok(match Value::deserialize(deserializer)? {
        Value::Text(text) => Some(text),
        Value::Other(_) => None,
    })
}

fn lenient_bool<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<bool>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Value {
        Flag(bool),
        Other(IgnoredAny),
    }
    Ok(match Value::deserialize(deserializer)? {
        Value::Flag(flag) => Some(flag),
        Value::Other(_) => None,
    })
}

/// The stdin payload of a hook. Unknown fields (including the often huge `tool_response`) are skipped.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct HookInput {
    #[serde(deserialize_with = "lenient_string")]
    pub session_id: Option<String>,
    #[serde(deserialize_with = "lenient_string")]
    pub hook_event_name: Option<String>,
    #[serde(deserialize_with = "lenient_string")]
    pub transcript_path: Option<String>,
    #[serde(deserialize_with = "lenient_string")]
    pub cwd: Option<String>,
    #[serde(deserialize_with = "lenient_string")]
    pub tool_name: Option<String>,
    pub tool_input: Option<ToolInput>,
    #[serde(deserialize_with = "lenient_string")]
    pub notification_type: Option<String>,
    #[serde(deserialize_with = "lenient_string")]
    pub message: Option<String>,
    #[serde(deserialize_with = "lenient_string")]
    pub last_assistant_message: Option<String>,
    #[serde(deserialize_with = "lenient_string")]
    pub error: Option<String>,
    #[serde(deserialize_with = "lenient_string")]
    pub error_details: Option<String>,
    #[serde(deserialize_with = "lenient_bool")]
    pub is_interrupt: Option<bool>,
    #[serde(deserialize_with = "lenient_string")]
    pub session_title: Option<String>,
}

/// Everything about the world the event handler needs, injected so tests control it.
#[derive(Clone, Debug, Default)]
pub struct HookEnv {
    pub now_ms: u64,
    pub now_ns: u64,
    pub transcript_size: Option<u64>,
    /// Process id and creation time of Claude Code (the hook's parent).
    pub parent: Option<(u32, Option<u64>)>,
    pub terminal: TerminalHint,
}

/// Name shown for a working folder. Inside a Claude worktree (`<repo>\.claude\worktrees\<name>`) the repo wins.
pub fn project_name(cwd: &str) -> String {
    let parts: Vec<&str> = cwd.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    for (i, window) in parts.windows(2).enumerate() {
        if i > 0 && window[0] == ".claude" && window[1] == "worktrees" && !parts[i - 1].ends_with(':') {
            return parts[i - 1].to_owned();
        }
    }
    basename(cwd).to_owned()
}

/// First readable line of a reply, with markdown noise removed.
pub fn first_line(text: &str) -> Option<String> {
    text.lines().find_map(|raw| {
        let mut line = String::with_capacity(raw.len());
        let mut rest = raw;
        // [label](url) keeps only the label.
        while let Some(open) = rest.find('[') {
            let Some(mid) = rest[open..].find("](").map(|i| open + i) else { break };
            let Some(close) = rest[mid..].find(')').map(|i| mid + i) else { break };
            line.push_str(&rest[..open]);
            line.push_str(&rest[open + 1..mid]);
            rest = &rest[close + 1..];
        }
        line.push_str(rest);
        let cleaned: String = line.trim_start_matches([' ', '\t', '>', '#', '*', '-', '•']).replace(['*', '`'], "");
        let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
        let meaningful = cleaned.chars().count() >= 4 && cleaned.chars().any(char::is_alphanumeric);
        meaningful.then(|| clip(&cleaned, SUMMARY_LIMIT))
    })
}

fn begin_turn(state: &mut SessionState, env: &HookEnv) {
    state.turn_started_at = Some(env.now_ms);
    state.turn_offset = env.transcript_size.unwrap_or(0);
}

fn set_activity(state: &mut SessionState, phase: Phase, tool: Option<String>, detail: Option<String>) {
    state.phase = phase;
    state.tool = tool;
    state.detail = detail;
    state.summary = None;
    state.problem = None;
}

/// Applies one hook event to the previous state. `None` means "nothing to record" (unknown event, an event
/// that does not change anything, or an older event than what is already on disk).
pub fn apply(prev: Option<&SessionState>, input: &HookInput, env: &HookEnv) -> Option<SessionState> {
    if prev.is_some_and(|p| p.seq > env.now_ns) {
        return None;
    }
    let event = input.hook_event_name.as_deref()?;
    let id = sanitize_id(input.session_id.as_deref()?);
    if id.is_empty() {
        return None;
    }
    let mut next = prev.cloned().unwrap_or_else(|| SessionState::new(AgentKind::Claude, &id));
    let was = prev.map_or(Phase::Idle, |p| p.phase);
    let fresh_turn = !was.is_active() || prev.is_none();

    match event {
        "UserPromptSubmit" => {
            set_activity(&mut next, Phase::Thinking, None, None);
            begin_turn(&mut next, env);
        }
        "PreToolUse" => {
            let described = describe_claude(
                input.tool_name.as_deref().unwrap_or(""),
                input.tool_input.as_ref().unwrap_or(&ToolInput::default()),
            );
            if fresh_turn {
                begin_turn(&mut next, env);
            }
            set_activity(&mut next, described.phase, described.tool, described.detail);
        }
        "PostToolUse" => {
            if fresh_turn {
                begin_turn(&mut next, env);
            }
            set_activity(&mut next, Phase::Thinking, None, None);
        }
        "PostToolUseFailure" => {
            let phase = if input.is_interrupt == Some(true) { Phase::Paused } else { Phase::Thinking };
            if fresh_turn && phase == Phase::Thinking {
                begin_turn(&mut next, env);
            }
            set_activity(&mut next, phase, None, None);
        }
        "Stop" => {
            set_activity(&mut next, Phase::Done, None, None);
            next.summary = input.last_assistant_message.as_deref().and_then(first_line);
        }
        "StopFailure" => {
            let text = input.last_assistant_message.as_deref().or(input.error_details.as_deref()).unwrap_or("");
            let problem = classify(input.error.as_deref().unwrap_or(""), text);
            let phase = if problem.kind == ProblemKind::UsageLimit { Phase::Limit } else { Phase::Error };
            set_activity(&mut next, phase, None, None);
            next.problem = Some(problem);
        }
        "SessionEnd" => set_activity(&mut next, Phase::Stopped, None, None),
        "Notification" => match input.notification_type.as_deref() {
            Some("idle_prompt") if was.is_working() => set_activity(&mut next, Phase::Idle, None, None),
            Some("permission_prompt" | "agent_needs_input" | "elicitation_dialog") if was.is_active() => {
                let notice = input.message.as_deref().map(|m| clip(m.trim(), NOTICE_LIMIT));
                set_activity(&mut next, Phase::Waiting, None, notice);
            }
            _ => return None,
        },
        _ => return None,
    }

    if let Some(cwd) = input.cwd.as_deref().filter(|c| !c.is_empty()) {
        next.project = project_name(cwd);
        next.cwd = Some(cwd.to_owned());
    }
    if let Some(path) = input.transcript_path.as_deref().filter(|p| !p.is_empty()) {
        next.transcript = Some(path.to_owned());
    }
    if let Some(title) = input.session_title.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        next.title = Some(clip(title, NOTICE_LIMIT));
    }
    if let Some((pid, start)) = env.parent {
        next.pid = Some(pid);
        next.pid_start = start;
    }
    if !env.terminal.is_empty() {
        next.terminal = env.terminal.clone();
    }
    next.updated_at = env.now_ms;
    next.seq = env.now_ns;
    Some(next)
}

/// Reads the hook payload, bounded.
pub fn read_input(reader: impl Read) -> Option<HookInput> {
    let mut bytes = Vec::new();
    reader.take(MAX_STDIN_BYTES).read_to_end(&mut bytes).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn terminal_from_env() -> TerminalHint {
    let var = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());
    TerminalHint { program: var("TERM_PROGRAM"), wt_session: var("WT_SESSION") }
}

/// Environment of this process, for the real binary.
pub fn current_env(transcript: Option<&str>) -> HookEnv {
    let parent = process::parent_pid().map(|pid| (pid, process::creation_time(pid)));
    HookEnv {
        now_ms: now_ms(),
        now_ns: now_ns(),
        transcript_size: transcript.and_then(|p| std::fs::metadata(p).ok()).map(|m| m.len()),
        parent,
        terminal: terminal_from_env(),
    }
}

/// Held while the hook reads and rewrites a state file, so two hook processes starting a few milliseconds
/// apart cannot interleave. Best effort: after `LOCK_WAIT` the hook writes without it.
struct FolderLock {
    file: Option<std::fs::File>,
}

impl FolderLock {
    fn acquire(dir: &std::path::Path) -> Self {
        let open = || std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(dir.join(LOCK_FILE));
        let file = match open() {
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                std::fs::create_dir_all(dir).and_then(|()| open())
            }
            other => other,
        };
        let Some(file) = file.ok() else { return Self { file: None } };
        let started = Instant::now();
        loop {
            if file.try_lock().is_ok() {
                return Self { file: Some(file) };
            }
            if started.elapsed() >= LOCK_WAIT {
                return Self { file: None };
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }
}

impl Drop for FolderLock {
    fn drop(&mut self) {
        if let Some(file) = &self.file {
            let _ = file.unlock();
        }
    }
}

/// Handles one hook invocation end to end. Returns true if a state file was written.
pub fn handle(dirs: &ClaudeDirs, input: &HookInput, env: &HookEnv) -> bool {
    let Some(id) = input.session_id.as_deref().map(sanitize_id).filter(|id| !id.is_empty()) else { return false };
    let sessions = dirs.sessions_dir();
    let _lock = FolderLock::acquire(&sessions);
    let prev = SessionState::read(&crate::state::file_for(&sessions, &id)).ok();
    match apply(prev.as_ref(), input, env) {
        Some(next) => next.write(&sessions).is_ok(),
        None => false,
    }
}

/// Claude Code's hook: stdin to state file. Never panics, never returns an error.
pub fn run_from_stdin() {
    let Some(input) = read_input(std::io::stdin().lock()) else { return };
    let Some(dirs) = ClaudeDirs::from_env() else { return };
    let env = current_env(input.transcript_path.as_deref());
    handle(&dirs, &input, &env);
}

/// The binary's entry point. `--agent copilot` selects the GitHub Copilot CLI adapter; the entries Connect
/// writes into Claude Code's settings carry no arguments and read a Claude Code event.
pub fn run(args: &[String]) {
    if args.windows(2).any(|pair| pair[0] == "--agent" && pair[1] == crate::copilot::AGENT) {
        crate::copilot::run_from_stdin(&crate::copilot::HookArgs::parse(args));
    } else {
        run_from_stdin();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(ms: u64) -> HookEnv {
        HookEnv { now_ms: ms, now_ns: ms * 1_000_000, transcript_size: Some(1000), ..HookEnv::default() }
    }

    fn input(json: &str) -> HookInput {
        read_input(json.as_bytes()).expect("hook input")
    }

    fn event(name: &str, extra: &str) -> HookInput {
        input(&format!(r#"{{"session_id":"s1","hook_event_name":"{name}","cwd":"D:\\work\\dotDock"{extra}}}"#))
    }

    fn step(prev: Option<&SessionState>, name: &str, extra: &str, ms: u64) -> SessionState {
        apply(prev, &event(name, extra), &env(ms)).unwrap_or_else(|| panic!("{name} produced no state"))
    }

    #[test]
    fn a_full_turn_walks_through_the_expected_phases() {
        let s = step(None, "UserPromptSubmit", r#","prompt":"secret prompt text""#, 1_000);
        assert_eq!((s.phase, s.turn_started_at, s.turn_offset), (Phase::Thinking, Some(1_000), 1_000));
        assert_eq!(s.project, "dotDock");
        let s =
            step(Some(&s), "PreToolUse", r#","tool_name":"Read","tool_input":{"file_path":"C:\\a\\b\\lib.rs"}"#, 2_000);
        assert_eq!((s.phase, s.detail.as_deref(), s.turn_started_at), (Phase::Reading, Some("lib.rs"), Some(1_000)));
        let s = step(Some(&s), "PostToolUse", r#","tool_name":"Read","tool_response":{"content":"big"}"#, 3_000);
        assert_eq!((s.phase, s.tool.as_deref(), s.detail.as_deref()), (Phase::Thinking, None, None));
        let s = step(
            Some(&s),
            "PreToolUse",
            r#","tool_name":"Bash","tool_input":{"command":"cargo test","description":"Run tests"}"#,
            4_000,
        );
        assert_eq!((s.phase, s.detail.as_deref()), (Phase::Running, Some("Run tests")));
        let s = step(Some(&s), "Stop", r#","last_assistant_message":"**Done.** All 12 tests pass.\nMore text""#, 5_000);
        assert_eq!((s.phase, s.summary.as_deref()), (Phase::Done, Some("Done. All 12 tests pass.")));
        assert_eq!(s.turn_started_at, Some(1_000), "the finished turn keeps its start for the elapsed display");
        let s = step(Some(&s), "SessionEnd", r#","reason":"other""#, 6_000);
        assert_eq!(s.phase, Phase::Stopped);
    }

    #[test]
    fn prompt_and_tool_output_are_never_stored() {
        let s = step(None, "UserPromptSubmit", r#","prompt":"my password is hunter2""#, 1);
        let json = serde_json::to_string(&s).expect("json");
        assert!(!json.contains("hunter2"));
        let s = step(Some(&s), "PostToolUse", r#","tool_name":"Read","tool_response":{"content":"api_key=abc"}"#, 2);
        assert!(!serde_json::to_string(&s).expect("json").contains("api_key"));
    }

    #[test]
    fn an_older_event_never_overwrites_a_newer_state() {
        let newer = step(None, "UserPromptSubmit", "", 5_000);
        assert!(apply(Some(&newer), &event("Stop", ""), &env(4_000)).is_none());
    }

    #[test]
    fn a_tool_event_after_done_starts_a_new_turn() {
        let done = step(Some(&step(None, "UserPromptSubmit", "", 1_000)), "Stop", "", 2_000);
        let s = step(Some(&done), "PreToolUse", r#","tool_name":"Grep","tool_input":{"pattern":"x"}"#, 3_000);
        assert_eq!((s.phase, s.turn_started_at), (Phase::Searching, Some(3_000)));
        assert_eq!(s.summary, None);
    }

    #[test]
    fn idle_notification_only_collapses_working_sessions() {
        let working = step(None, "UserPromptSubmit", "", 1_000);
        let idle = step(Some(&working), "Notification", r#","notification_type":"idle_prompt""#, 2_000);
        assert_eq!(idle.phase, Phase::Idle);
        let done = step(Some(&working), "Stop", "", 2_000);
        assert!(
            apply(Some(&done), &event("Notification", r#","notification_type":"idle_prompt""#), &env(3_000)).is_none()
        );
    }

    #[test]
    fn permission_prompt_marks_waiting_and_the_next_tool_event_resumes() {
        let working = step(None, "PreToolUse", r#","tool_name":"Bash","tool_input":{"command":"rm x"}"#, 1_000);
        let waiting = step(
            Some(&working),
            "Notification",
            r#","notification_type":"permission_prompt","message":"Claude needs your permission to use Bash""#,
            2_000,
        );
        assert_eq!(
            (waiting.phase, waiting.detail.as_deref()),
            (Phase::Waiting, Some("Claude needs your permission to use Bash"))
        );
        let resumed = step(Some(&waiting), "PostToolUse", r#","tool_name":"Bash""#, 3_000);
        assert_eq!(resumed.phase, Phase::Thinking);
        let ask = step(Some(&resumed), "PreToolUse", r#","tool_name":"AskUserQuestion","tool_input":{}"#, 4_000);
        assert_eq!(ask.phase, Phase::Waiting);
    }

    #[test]
    fn stop_failure_maps_usage_limits_and_login_errors() {
        let start = step(None, "UserPromptSubmit", "", 1_000);
        let limit = step(
            Some(&start),
            "StopFailure",
            r#","error":"rate_limit","last_assistant_message":"You've hit your session limit · resets 1:50pm (Asia/Taipei)""#,
            2_000,
        );
        assert_eq!(limit.phase, Phase::Limit);
        let problem = limit.problem.expect("problem");
        assert_eq!((problem.kind, problem.resets.as_deref()), (ProblemKind::UsageLimit, Some("1:50pm")));
        let login = step(
            Some(&start),
            "StopFailure",
            r#","error":"authentication_failed","last_assistant_message":"Please run /login""#,
            2_000,
        );
        assert_eq!((login.phase, login.problem.map(|p| p.kind)), (Phase::Error, Some(ProblemKind::Login)));
    }

    #[test]
    fn interrupted_tool_failure_pauses_but_ordinary_failure_keeps_thinking() {
        let start = step(None, "UserPromptSubmit", "", 1_000);
        let paused = step(Some(&start), "PostToolUseFailure", r#","tool_name":"Bash","is_interrupt":true"#, 2_000);
        assert_eq!(paused.phase, Phase::Paused);
        let failed = step(
            Some(&start),
            "PostToolUseFailure",
            r#","tool_name":"Bash","error":"Exit code 1","is_interrupt":false"#,
            2_000,
        );
        assert_eq!(failed.phase, Phase::Thinking);
    }

    #[test]
    fn unknown_events_and_malformed_input_are_ignored() {
        assert!(apply(None, &event("PreCompact", ""), &env(1)).is_none());
        assert!(apply(None, &input(r#"{"hook_event_name":"Stop"}"#), &env(1)).is_none());
        assert!(read_input(&b"not json"[..]).is_none());
        assert!(read_input(&b""[..]).is_none());
        let odd = input(
            r#"{"session_id":"s1","hook_event_name":"Stop","cwd":42,"is_interrupt":"yes","last_assistant_message":null}"#,
        );
        assert!(apply(None, &odd, &env(1)).is_some(), "wrong field types are tolerated");
    }

    #[test]
    fn process_and_terminal_facts_are_recorded() {
        let mut e = env(1_000);
        e.parent = Some((4321, Some(99)));
        e.terminal = TerminalHint { program: Some("vscode".into()), wt_session: None };
        let s = apply(
            None,
            &event("UserPromptSubmit", r#","transcript_path":"C:\\t\\s.jsonl","session_title":"Fix the build""#),
            &e,
        )
        .expect("state");
        assert_eq!((s.pid, s.pid_start), (Some(4321), Some(99)));
        assert_eq!(s.terminal.program.as_deref(), Some("vscode"));
        assert_eq!(s.transcript.as_deref(), Some(r"C:\t\s.jsonl"));
        assert_eq!(s.title.as_deref(), Some("Fix the build"));
    }

    #[test]
    fn project_name_sees_through_worktrees() {
        assert_eq!(project_name(r"D:\dotDock"), "dotDock");
        assert_eq!(project_name(r"D:\dotDock\.claude\worktrees\agent-a057"), "dotDock");
        assert_eq!(project_name("/home/me/app/"), "app");
        assert_eq!(project_name(r"C:\.claude\worktrees\x"), "x", "a drive letter is not a project");
    }

    #[test]
    fn first_line_strips_markdown_and_skips_noise() {
        assert_eq!(first_line("## Result\nbody").as_deref(), Some("Result"));
        assert_eq!(
            first_line("---\n\nSee [the docs](https://x.y) for `more`").as_deref(),
            Some("See the docs for more")
        );
        assert_eq!(first_line("ok\n\nFixed the layout bug").as_deref(), Some("Fixed the layout bug"));
        assert_eq!(first_line("  \n--\n").as_deref(), None);
        assert!(first_line(&"word ".repeat(100)).expect("line").chars().count() <= SUMMARY_LIMIT + 1);
    }

    #[test]
    fn handle_writes_the_state_file_and_keeps_order_across_runs() {
        let dir = tempfile::tempdir().expect("tempdir");
        let dirs = ClaudeDirs::at(dir.path());
        assert!(handle(&dirs, &event("UserPromptSubmit", ""), &env(1_000)));
        assert!(handle(
            &dirs,
            &event("PreToolUse", r#","tool_name":"Edit","tool_input":{"file_path":"a.ts"}"#),
            &env(2_000)
        ));
        assert!(!handle(&dirs, &event("Stop", ""), &env(1_500)), "stale event is dropped");
        let state = SessionState::read(&crate::state::file_for(&dirs.sessions_dir(), "s1")).expect("read");
        assert_eq!((state.phase, state.detail.as_deref()), (Phase::Editing, Some("a.ts")));
    }

    #[test]
    fn handle_survives_a_corrupt_previous_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let dirs = ClaudeDirs::at(dir.path());
        std::fs::create_dir_all(dirs.sessions_dir()).expect("mkdir");
        std::fs::write(dirs.sessions_dir().join("s1.json"), b"{broken").expect("write");
        assert!(handle(&dirs, &event("UserPromptSubmit", ""), &env(1_000)));
    }
}

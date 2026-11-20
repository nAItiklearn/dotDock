//! GitHub Copilot CLI adapter.
//!
//! Copilot CLI runs "hooks" from `~\.copilot\hooks\*.json` (or `$COPILOT_HOME\hooks`): commands that receive one
//! event as JSON on stdin. Connect registers `dotdock-island-hook --agent copilot --event <name> --spool <dir>`
//! for the events below; the hook turns each payload into one feed event and appends it to
//! `<spool>\copilot-<session>.jsonl`.
//!
//! Payloads follow GitHub's hooks reference (docs.github.com/en/copilot/reference/hooks-configuration) and the
//! hook input types that ship with the CLI (`copilot-sdk/types.d.ts`, release 1.0.83): `sessionId`, `timestamp`
//! (epoch milliseconds), `cwd`, then per event `prompt`, `toolName` and `toolArgs`, `error`, `stopReason`,
//! `reason`, and for `notification` the Claude-style `message` and `notification_type`. Hooks registered under a
//! PascalCase event name receive the same data in snake_case with an ISO 8601 `timestamp` and a
//! `hook_event_name`; both spellings are read.
//!
//! Prompts, tool results and file contents are never copied: the feed event keeps the tool, one short detail
//! and the phase, nothing else.

use crate::describe::describe_agent_tool;
use crate::feed::{self, FeedEvent};
use crate::phase::Phase;
use crate::problem::{classify, Problem, ProblemKind};
use crate::process;
use crate::transcript::parse_iso_ms;
use crate::util::clip;
use serde_json::Value;
use std::io::Read;
use std::path::PathBuf;

pub const AGENT: &str = "copilot";
/// The hook events Connect registers, in the camelCase spelling.
pub const EVENTS: [&str; 9] = [
    "sessionStart",
    "userPromptSubmitted",
    "preToolUse",
    "postToolUse",
    "postToolUseFailure",
    "errorOccurred",
    "agentStop",
    "sessionEnd",
    "notification",
];
/// Longest stdin the hook reads. Tool results can be large; the island needs none of them.
const MAX_STDIN_BYTES: u64 = 64 * 1024 * 1024;
const NOTICE_LIMIT: usize = 80;

/// The camelCase name of an event given in either spelling. `None` for events the island does not use.
fn canonical_event(name: &str) -> Option<&'static str> {
    Some(match name {
        "sessionStart" | "SessionStart" => "sessionStart",
        "userPromptSubmitted" | "UserPromptSubmit" => "userPromptSubmitted",
        "preToolUse" | "PreToolUse" => "preToolUse",
        "postToolUse" | "PostToolUse" => "postToolUse",
        "postToolUseFailure" | "PostToolUseFailure" => "postToolUseFailure",
        "errorOccurred" | "ErrorOccurred" => "errorOccurred",
        "agentStop" | "Stop" => "agentStop",
        "sessionEnd" | "SessionEnd" => "sessionEnd",
        "notification" | "Notification" => "notification",
        _ => return None,
    })
}

/// The value under the first of `keys` that is present: a field has a camelCase and a snake_case spelling.
fn field<'a>(payload: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|key| payload.get(*key))
}

fn string<'a>(payload: &'a Value, keys: &[&str]) -> Option<&'a str> {
    field(payload, keys).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
}

/// `error` is a message string or an object with a `message`.
fn error_message(payload: &Value) -> Option<&str> {
    match payload.get("error")? {
        Value::String(message) => Some(message.as_str()),
        object => object.get("message").and_then(Value::as_str),
    }
    .map(str::trim)
    .filter(|m| !m.is_empty())
}

/// Epoch milliseconds from a number (the native payload) or an ISO 8601 string (the PascalCase payload).
fn time_of(payload: &Value) -> Option<u64> {
    match payload.get("timestamp")? {
        Value::Number(n) => n.as_u64(),
        Value::String(text) => parse_iso_ms(text),
        _ => None,
    }
}

/// The phase and problem a failure message stands for: a usage limit, or a plain error.
fn failure(message: Option<&str>) -> (Phase, Problem) {
    let problem = classify("", message.unwrap_or(""));
    let phase = if problem.kind == ProblemKind::UsageLimit { Phase::Limit } else { Phase::Error };
    (phase, problem)
}

/// One hook payload to one feed event. `event` is the hook's name for it; `payload` the parsed stdin; `pid` the
/// Copilot process that ran the hook. `None` for events the island does not show.
pub fn translate(event: &str, payload: &Value, pid: Option<u32>) -> Option<FeedEvent> {
    let kind = canonical_event(event)?;
    let mut out = FeedEvent {
        agent: AGENT.to_owned(),
        session: string(payload, &["sessionId", "session_id"])?.to_owned(),
        at: time_of(payload),
        cwd: string(payload, &["cwd", "workingDirectory", "working_directory"]).map(str::to_owned),
        pid,
        ..FeedEvent::default()
    };
    match kind {
        "sessionStart" => {}
        "userPromptSubmitted" | "postToolUse" | "postToolUseFailure" => out.phase = Some(Phase::Thinking),
        "preToolUse" => {
            let args = field(payload, &["toolArgs", "tool_args", "tool_input"]).unwrap_or(&Value::Null);
            let described = describe_agent_tool(string(payload, &["toolName", "tool_name"])?, args);
            (out.phase, out.tool, out.detail) = (Some(described.phase), described.tool, described.detail);
        }
        "errorOccurred" => {
            // A recoverable error is one the CLI retries or works around; only a hard stop is worth showing.
            if payload.get("recoverable").and_then(Value::as_bool) == Some(true) {
                return None;
            }
            let (phase, problem) = failure(error_message(payload));
            (out.phase, out.problem) = (Some(phase), Some(problem));
        }
        // The CLI sends no reply text with the stop, so a finished turn has no summary.
        "agentStop" => out.phase = Some(Phase::Done),
        "sessionEnd" => match string(payload, &["reason"])? {
            "user_exit" => out.phase = Some(Phase::Stopped),
            "abort" => out.phase = Some(Phase::Paused),
            "error" | "timeout" => {
                let (phase, problem) = failure(error_message(payload));
                (out.phase, out.problem) = (Some(phase), Some(problem));
            }
            // A completed turn was already reported by `agentStop`.
            _ => return None,
        },
        "notification" => match string(payload, &["notification_type", "notificationType"])? {
            "permission_prompt" | "elicitation_dialog" => {
                out.phase = Some(Phase::Waiting);
                out.detail = string(payload, &["message"]).map(|m| clip(m, NOTICE_LIMIT));
            }
            _ => return None,
        },
        _ => return None,
    }
    Some(out)
}

/// What the registered command line carries.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct HookArgs {
    pub event: Option<String>,
    pub spool: Option<PathBuf>,
}

impl HookArgs {
    /// Reads `--event <name>` and `--spool <dir>`; anything else is ignored so a newer app can add options.
    pub fn parse(args: &[String]) -> Self {
        let mut parsed = Self::default();
        let mut args = args.iter();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--event" => parsed.event = args.next().cloned(),
                "--spool" => parsed.spool = args.next().map(PathBuf::from),
                _ => {}
            }
        }
        parsed
    }
}

/// The hook's whole job for Copilot: stdin to one appended feed line. Never panics, never reports an error.
pub fn run_from_stdin(args: &HookArgs) {
    let mut bytes = Vec::new();
    if std::io::stdin().lock().take(MAX_STDIN_BYTES).read_to_end(&mut bytes).is_err() {
        return;
    }
    let Ok(payload) = serde_json::from_slice::<Value>(&bytes) else { return };
    let Some(spool) = &args.spool else { return };
    let name = args.event.as_deref().or_else(|| payload.get("hook_event_name").and_then(Value::as_str));
    let Some(event) = name.and_then(|name| translate(name, &payload, process::parent_pid())) else { return };
    let _ = feed::append(spool, &format!("{AGENT}-{}", event.session), &event);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Payloads as GitHub's hooks reference and the CLI's own hook input types (1.0.83) define them.
    const SESSION: &str = r#""sessionId":"3f1c8e52-93d6-4c61-8d0a-6b1e2f7a9c10","timestamp":1795062601000,"cwd":"D:\\work\\dotDock""#;

    fn payload(extra: &str) -> Value {
        serde_json::from_str(&format!("{{{SESSION}{extra}}}")).expect("fixture json")
    }

    fn translated(event: &str, extra: &str) -> FeedEvent {
        translate(event, &payload(extra), Some(777)).unwrap_or_else(|| panic!("{event} produced no event"))
    }

    #[test]
    fn every_event_carries_the_session_the_time_the_folder_and_the_process() {
        let e = translated("userPromptSubmitted", r#","prompt":"Fix the layout bug in the header""#);
        assert_eq!(e.agent, "copilot");
        assert_eq!(e.session, "3f1c8e52-93d6-4c61-8d0a-6b1e2f7a9c10");
        assert_eq!((e.at, e.cwd.as_deref(), e.pid), (Some(1_795_062_601_000), Some("D:\\work\\dotDock"), Some(777)));
        assert_eq!(e.phase, Some(Phase::Thinking));
    }

    #[test]
    fn prompts_and_results_are_never_copied() {
        let prompt = translated("userPromptSubmitted", r#","prompt":"my secret plan""#);
        let result = translated(
            "postToolUse",
            r#","toolName":"view","toolArgs":{"path":"a.rs"},"toolResult":{"resultType":"success","textResultForLlm":"fn secret() {}"}"#,
        );
        for e in [prompt, result] {
            let line = e.to_line();
            assert!(!line.contains("secret"), "{line}");
        }
    }

    #[test]
    fn tool_calls_show_the_file_command_or_pattern() {
        let e = translated("preToolUse", r#","toolName":"view","toolArgs":{"path":"D:\\work\\dotDock\\src\\lib.rs"}"#);
        assert_eq!((e.phase, e.tool.as_deref(), e.detail.as_deref()), (Some(Phase::Reading), Some("Read"), Some("lib.rs")));
        let e = translated("preToolUse", r#","toolName":"powershell","toolArgs":{"command":"cargo test","description":"Run the tests"}"#);
        assert_eq!((e.phase, e.detail.as_deref()), (Some(Phase::Running), Some("Run the tests")));
        let e = translated("preToolUse", r#","toolName":"grep","toolArgs":{"pattern":"fn main","path":"src"}"#);
        assert_eq!((e.phase, e.detail.as_deref()), (Some(Phase::Searching), Some("fn main")));
        let e = translated("preToolUse", r#","toolName":"edit","toolArgs":{"path":"C:\\x\\app.css","old_str":"a","new_str":"b"}"#);
        assert_eq!((e.phase, e.detail.as_deref()), (Some(Phase::Editing), Some("app.css")));
        let e = translated("preToolUse", r#","toolName":"ask_user","toolArgs":{"question":"Which branch?"}"#);
        assert_eq!(e.phase, Some(Phase::Waiting));
    }

    #[test]
    fn older_releases_sent_the_arguments_as_a_json_string() {
        let e = translated("preToolUse", r#","toolName":"bash","toolArgs":"{\"command\":\"ls -la\"}""#);
        assert_eq!((e.phase, e.detail.as_deref()), (Some(Phase::Searching), Some("ls -la")));
    }

    #[test]
    fn a_finished_tool_goes_back_to_thinking_and_a_stop_is_done() {
        assert_eq!(translated("postToolUse", r#","toolName":"view","toolArgs":{},"toolResult":{"resultType":"success"}"#).phase, Some(Phase::Thinking));
        assert_eq!(translated("postToolUseFailure", r#","toolName":"bash","toolArgs":{},"error":"exit 1""#).phase, Some(Phase::Thinking));
        let stop = translated("agentStop", r#","transcriptPath":"C:\\x\\t.jsonl","stopReason":"end_turn","stop_hook_active":false"#);
        assert_eq!((stop.phase, stop.summary), (Some(Phase::Done), None));
    }

    #[test]
    fn session_start_only_names_the_session() {
        let e = translated("sessionStart", r#","source":"new","initialPrompt":"private""#);
        assert_eq!(e.phase, None);
        assert!(!e.to_line().contains("private"));
    }

    #[test]
    fn errors_map_to_limit_login_or_a_plain_error_and_recoverable_ones_are_ignored() {
        let e = translated("errorOccurred", r#","error":{"message":"You've hit your session limit · resets 5pm","name":"RateLimitError"},"errorContext":"model_call","recoverable":false"#);
        assert_eq!(e.phase, Some(Phase::Limit));
        assert_eq!(e.problem.as_ref().map(|p| (p.kind, p.resets.as_deref())), Some((ProblemKind::UsageLimit, Some("5pm"))));
        let e = translated("errorOccurred", r#","error":"Please run /login","errorContext":"model_call","recoverable":false"#);
        assert_eq!((e.phase, e.problem.map(|p| p.kind)), (Some(Phase::Error), Some(ProblemKind::Login)));
        assert!(translate("errorOccurred", &payload(r#","error":{"message":"timed out","name":"E"},"errorContext":"tool_execution","recoverable":true"#), None).is_none());
    }

    #[test]
    fn session_end_reasons() {
        assert_eq!(translated("sessionEnd", r#","reason":"user_exit""#).phase, Some(Phase::Stopped));
        assert_eq!(translated("sessionEnd", r#","reason":"abort""#).phase, Some(Phase::Paused));
        let e = translated("sessionEnd", r#","reason":"error","error":"connect ECONNRESET""#);
        assert_eq!((e.phase, e.problem.map(|p| p.kind)), (Some(Phase::Error), Some(ProblemKind::Connection)));
        assert!(translate("sessionEnd", &payload(r#","reason":"complete""#), None).is_none(), "agentStop already said Done");
    }

    #[test]
    fn permission_prompts_wait_for_the_user_and_other_notifications_stay_quiet() {
        let e = translated(
            "notification",
            r#","hook_event_name":"Notification","message":"Copilot needs permission to run powershell","title":"Permission","notification_type":"permission_prompt""#,
        );
        assert_eq!((e.phase, e.detail.as_deref()), (Some(Phase::Waiting), Some("Copilot needs permission to run powershell")));
        for quiet in ["shell_completed", "agent_idle"] {
            assert!(translate("notification", &payload(&format!(r#","message":"x","notification_type":"{quiet}""#)), None).is_none());
        }
    }

    #[test]
    fn pascal_case_hooks_send_snake_case_payloads_with_iso_times() {
        let payload: Value = serde_json::from_str(
            r#"{"hook_event_name":"PreToolUse","session_id":"abc","timestamp":"2026-11-19T04:30:01.000Z","cwd":"D:\\work\\dotDock","tool_name":"view","tool_input":{"path":"src\\main.rs"}}"#,
        )
        .expect("json");
        let e = translate("PreToolUse", &payload, None).expect("event");
        assert_eq!((e.session.as_str(), e.at, e.phase, e.detail.as_deref()), ("abc", Some(1_795_062_601_000), Some(Phase::Reading), Some("main.rs")));
        let stop: Value = serde_json::from_str(r#"{"hook_event_name":"Stop","session_id":"abc","timestamp":"2026-11-19T04:31:00.000Z"}"#).expect("json");
        assert_eq!(translate("Stop", &stop, None).and_then(|e| e.phase), Some(Phase::Done));
    }

    #[test]
    fn payloads_without_a_session_and_unknown_events_are_dropped() {
        assert!(translate("agentStop", &serde_json::json!({"cwd": "D:\\x"}), None).is_none());
        assert!(translate("preCompact", &payload(r#","trigger":"auto""#), None).is_none());
        assert!(translate("preToolUse", &payload(r#","toolArgs":{}"#), None).is_none(), "a tool call without a tool name");
    }

    #[test]
    fn the_command_line_names_the_event_and_the_feed_folder() {
        let args: Vec<String> = ["--agent", "copilot", "--event", "preToolUse", "--spool", r"C:\data\agents", "--later", "x"]
            .map(String::from)
            .to_vec();
        assert_eq!(HookArgs::parse(&args), HookArgs { event: Some("preToolUse".into()), spool: Some(PathBuf::from(r"C:\data\agents")) });
        assert_eq!(HookArgs::parse(&[]), HookArgs::default());
    }

    #[test]
    fn registered_events_are_all_understood() {
        for name in EVENTS {
            assert_eq!(canonical_event(name), Some(name));
        }
    }
}

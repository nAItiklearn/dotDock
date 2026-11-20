//! OpenCode adapter.
//!
//! OpenCode 2 runs plugins inside its server, which serves every session of every terminal and window. The
//! plugin that Connect installs (`assets/opencode-plugin.js`) subscribes to the server's public event stream
//! and appends a small projection of the events the island needs, one per line, to the feed:
//!
//! ```text
//! {"v":1,"adapter":"opencode","pid":4242,"event":{"id":"evt_...","type":"session.tool.called","created":1795062601000,
//!  "location":{"directory":"D:\\work\\dotDock"},"data":{"sessionID":"ses_...","id":"call_1","input":{"filePath":"..."}}}}
//! ```
//!
//! The event types and their fields are those of `packages/schema/src/session-event.ts`, `permission.ts` and
//! `session-status-event.ts` in the OpenCode repository, which the shipped 2.2.1 binary contains. The plugin
//! forwards no prompt text, tool output or file contents; tool input is reduced to the few fields that name a
//! file, pattern, command or address. This module turns those events into feed events, one session at a time.

use crate::describe::describe_agent_tool;
use crate::feed::FeedEvent;
use crate::hook::first_line;
use crate::phase::Phase;
use crate::problem::{classify, Problem, ProblemKind};
use crate::util::clip;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};

const AGENT: &str = "opencode";
/// How many event ids are remembered to drop duplicates: every plugin instance sees the whole stream.
const SEEN_EVENTS: usize = 512;
const NOTICE_LIMIT: usize = 80;
/// `event.created` below this is not an epoch-millisecond time.
const MIN_EPOCH_MS: u64 = 1_000_000_000_000;

#[derive(Default)]
struct Session {
    /// Sub-agent sessions are folded into their parent's `task` tool call, not shown on their own.
    child: bool,
    cwd: Option<String>,
    /// Tool call id to tool name; the name arrives with `session.tool.input.started`, the input later.
    tools: HashMap<String, String>,
    /// The latest finished text block of the turn, for the Done summary.
    text: Option<String>,
    tokens_out: u64,
}

/// Turns OpenCode events into feed events. Holds what one event cannot say alone.
#[derive(Default)]
pub struct Translator {
    sessions: HashMap<String, Session>,
    seen: VecDeque<String>,
}

fn str_at<'a>(value: &'a Value, pointer: &str) -> Option<&'a str> {
    value.pointer(pointer).and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// The problem an `execution.failed` error stands for. OpenCode's error `type` names vary by provider, so the
/// HTTP status and the text decide.
fn problem_of(error: &Value) -> Problem {
    let status = error.get("status").and_then(Value::as_u64);
    let kind = str_at(error, "/type").unwrap_or("").to_ascii_lowercase();
    let code = if matches!(status, Some(401 | 403)) || kind.contains("auth") {
        "authentication_failed"
    } else if status == Some(429) {
        "rate_limit"
    } else {
        ""
    };
    classify(code, str_at(error, "/message").unwrap_or(""))
}

impl Translator {
    /// `true` the first time an event id is seen.
    fn first_time(&mut self, id: &str) -> bool {
        if self.seen.iter().any(|seen| seen == id) {
            return false;
        }
        if self.seen.len() == SEEN_EVENTS {
            self.seen.pop_front();
        }
        self.seen.push_back(id.to_owned());
        true
    }

    /// One adapter line to at most one feed event. `None` for events the island does not show, duplicates,
    /// sub-agent sessions and lines of another shape.
    pub fn translate(&mut self, line: &Value) -> Option<FeedEvent> {
        let event = line.get("event")?;
        let kind = str_at(event, "/type")?;
        if let Some(id) = str_at(event, "/id") {
            if !self.first_time(id) {
                return None;
            }
        }
        let data = event.get("data")?;
        let session_id = str_at(data, "/sessionID")?;
        let session = self.sessions.entry(session_id.to_owned()).or_default();
        if let Some(dir) = str_at(event, "/location/directory").or_else(|| str_at(data, "/location/directory")) {
            session.cwd = Some(dir.to_owned());
        }
        if kind == "session.created" {
            session.child = str_at(data, "/parentID").is_some();
        }
        if session.child {
            return None;
        }
        let at = event.get("created").and_then(Value::as_u64).filter(|t| *t >= MIN_EPOCH_MS);
        let mut out = FeedEvent {
            agent: AGENT.to_owned(),
            session: session_id.to_owned(),
            at,
            cwd: session.cwd.clone(),
            pid: line.get("pid").and_then(Value::as_u64).and_then(|p| u32::try_from(p).ok()),
            ..FeedEvent::default()
        };
        match kind {
            "session.created" | "session.renamed" => out.title = str_at(data, "/title").map(str::to_owned),
            "session.execution.started" => {
                session.text = None;
                session.tokens_out = 0;
                out.phase = Some(Phase::Thinking);
            }
            "session.step.started" | "session.reasoning.started" | "session.tool.success" | "session.tool.failed" => {
                out.phase = Some(Phase::Thinking);
            }
            "session.tool.input.started" => {
                let (id, name) = (str_at(data, "/id")?, str_at(data, "/name")?);
                session.tools.insert(id.to_owned(), name.to_owned());
                return None;
            }
            "session.tool.called" => {
                let name = str_at(data, "/id").and_then(|id| session.tools.get(id)).map_or("tool", String::as_str);
                let described = describe_agent_tool(name, data.get("input").unwrap_or(&Value::Null));
                (out.phase, out.tool, out.detail) = (Some(described.phase), described.tool, described.detail);
            }
            "session.text.ended" => {
                session.text = str_at(data, "/text").map(str::to_owned);
                return None;
            }
            "session.step.ended" => {
                let tokens = data.get("tokens")?;
                let number = |pointer: &str| tokens.pointer(pointer).and_then(Value::as_f64).unwrap_or(0.0).max(0.0);
                session.tokens_out += number("/output") as u64;
                out.tokens_out = Some(session.tokens_out);
                out.context = Some((number("/input") + number("/output") + number("/cache/read") + number("/cache/write")) as u64);
            }
            "session.execution.succeeded" => {
                out.phase = Some(Phase::Done);
                out.summary = session.text.take().and_then(|t| first_line(&t));
            }
            "session.execution.failed" => {
                let problem = problem_of(data.get("error").unwrap_or(&Value::Null));
                out.phase = Some(if problem.kind == ProblemKind::UsageLimit { Phase::Limit } else { Phase::Error });
                out.problem = Some(problem);
            }
            "session.execution.interrupted" => out.phase = Some(Phase::Paused),
            "permission.asked" => {
                let action = str_at(data, "/action").unwrap_or("tool");
                let what = data.get("resources").and_then(Value::as_array).and_then(|r| r.first()).and_then(Value::as_str);
                out.phase = Some(Phase::Waiting);
                out.detail = Some(clip(&what.map_or_else(|| action.to_owned(), |w| format!("{action}: {w}")), NOTICE_LIMIT));
            }
            "permission.replied" => out.phase = Some(Phase::Thinking),
            "session.deleted" => out.phase = Some(Phase::Idle),
            _ => return None,
        }
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Lines in the shape the plugin writes, with event bodies as OpenCode 2.2.1's public event stream sends them.
    fn line(kind: &str, data: &str) -> Value {
        line_with(kind, "", data)
    }

    fn line_with(kind: &str, extra: &str, data: &str) -> Value {
        let text = format!(
            r#"{{"v":1,"adapter":"opencode","pid":4242,"event":{{"type":"{kind}","created":1795062601000{extra},"location":{{"directory":"D:\\work\\dotDock"}},"data":{data}}}}}"#
        );
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("fixture is not JSON ({e}): {text}"))
    }

    const SES: &str = r#""sessionID":"ses_01JABC""#;

    fn run(t: &mut Translator, kind: &str, data: &str) -> Option<FeedEvent> {
        t.translate(&line(kind, data))
    }

    #[test]
    fn a_turn_from_prompt_to_done() {
        let mut t = Translator::default();
        let created = run(&mut t, "session.created", &format!(r#"{{{SES},"projectID":"prj_1","location":{{"directory":"D:\\work\\dotDock"}},"slug":"calm-fox","title":"Fix the header","version":"2.2.1"}}"#)).expect("created");
        assert_eq!((created.phase, created.title.as_deref(), created.cwd.as_deref()), (None, Some("Fix the header"), Some("D:\\work\\dotDock")));
        assert_eq!((created.agent.as_str(), created.session.as_str(), created.pid), ("opencode", "ses_01JABC", Some(4_242)));

        let started = run(&mut t, "session.execution.started", &format!("{{{SES}}}")).expect("started");
        assert_eq!((started.phase, started.at), (Some(Phase::Thinking), Some(1_795_062_601_000)));

        assert!(run(&mut t, "session.tool.input.started", &format!(r#"{{{SES},"assistantMessageID":"msg_1","id":"call_1","name":"read"}}"#)).is_none());
        let read = run(&mut t, "session.tool.called", &format!(r#"{{{SES},"assistantMessageID":"msg_1","id":"call_1","input":{{"filePath":"D:\\work\\dotDock\\src\\lib.rs"}},"executed":true}}"#)).expect("called");
        assert_eq!((read.phase, read.tool.as_deref(), read.detail.as_deref()), (Some(Phase::Reading), Some("Read"), Some("lib.rs")));

        let back = run(&mut t, "session.tool.success", &format!(r#"{{{SES},"id":"call_1"}}"#)).expect("success");
        assert_eq!(back.phase, Some(Phase::Thinking));

        let step = run(&mut t, "session.step.ended", &format!(r#"{{{SES},"assistantMessageID":"msg_1","finish":"stop","tokens":{{"input":3000,"output":412,"reasoning":10,"cache":{{"read":9000,"write":0}}}}}}"#)).expect("step");
        assert_eq!((step.phase, step.tokens_out, step.context), (None, Some(412), Some(12_412)));
        let step2 = run(&mut t, "session.step.ended", &format!(r#"{{{SES},"tokens":{{"input":100,"output":88,"reasoning":0,"cache":{{"read":0,"write":0}}}}}}"#)).expect("step 2");
        assert_eq!(step2.tokens_out, Some(500), "output tokens add up over the turn");

        assert!(run(&mut t, "session.text.ended", &format!(r#"{{{SES},"assistantMessageID":"msg_1","ordinal":0,"text":"Fixed the header layout.\nDetails follow."}}"#)).is_none());
        let done = run(&mut t, "session.execution.succeeded", &format!("{{{SES}}}")).expect("done");
        assert_eq!((done.phase, done.summary.as_deref()), (Some(Phase::Done), Some("Fixed the header layout.")));

        run(&mut t, "session.execution.started", &format!("{{{SES}}}")).expect("second turn");
        let again = run(&mut t, "session.step.ended", &format!(r#"{{{SES},"tokens":{{"input":1,"output":5,"reasoning":0,"cache":{{"read":0,"write":0}}}}}}"#)).expect("step");
        assert_eq!(again.tokens_out, Some(5), "a new turn restarts the count");
    }

    #[test]
    fn shell_edit_and_search_calls_show_what_they_touch() {
        let mut t = Translator::default();
        let mut call = |id: &str, name: &str, input: &str| {
            run(&mut t, "session.tool.input.started", &format!(r#"{{{SES},"id":"{id}","name":"{name}"}}"#));
            run(&mut t, "session.tool.called", &format!(r#"{{{SES},"id":"{id}","input":{input},"executed":true}}"#)).expect("called")
        };
        let shell = call("c1", "shell", r#"{"command":"cargo test -p island","description":"Run island tests"}"#);
        assert_eq!((shell.phase, shell.detail.as_deref()), (Some(Phase::Running), Some("Run island tests")));
        let edit = call("c2", "edit", r#"{"filePath":"C:\\x\\app.css"}"#);
        assert_eq!((edit.phase, edit.tool.as_deref(), edit.detail.as_deref()), (Some(Phase::Editing), Some("Edit"), Some("app.css")));
        let grep = call("c3", "grep", r#"{"pattern":"fn main"}"#);
        assert_eq!((grep.phase, grep.detail.as_deref()), (Some(Phase::Searching), Some("fn main")));
        let fetch = call("c4", "webfetch", r#"{"url":"https://opencode.ai/docs/plugins?x=1"}"#);
        assert_eq!((fetch.phase, fetch.tool.as_deref(), fetch.detail.as_deref()), (Some(Phase::Reading), Some("WebFetch"), Some("opencode.ai/docs/plugins")));
        let unknown = run(&mut t, "session.tool.called", &format!(r#"{{{SES},"id":"never-announced","input":{{}}}}"#)).expect("called");
        assert_eq!((unknown.phase, unknown.tool.as_deref()), (Some(Phase::Thinking), Some("tool")));
    }

    #[test]
    fn permission_prompts_wait_for_the_user() {
        let mut t = Translator::default();
        let asked = run(&mut t, "permission.asked", &format!(r#"{{"id":"per_1",{SES},"action":"bash","resources":["npm test","npm run lint"],"save":["npm *"]}}"#)).expect("asked");
        assert_eq!((asked.phase, asked.detail.as_deref()), (Some(Phase::Waiting), Some("bash: npm test")));
        let replied = run(&mut t, "permission.replied", &format!(r#"{{{SES},"requestID":"per_1","reply":"once"}}"#)).expect("replied");
        assert_eq!(replied.phase, Some(Phase::Thinking));
    }

    #[test]
    fn interruptions_and_failures_become_paused_limit_and_error() {
        let mut t = Translator::default();
        let paused = run(&mut t, "session.execution.interrupted", &format!(r#"{{{SES},"reason":"user"}}"#)).expect("interrupted");
        assert_eq!(paused.phase, Some(Phase::Paused));

        let limit = run(&mut t, "session.execution.failed", &format!(r#"{{{SES},"error":{{"type":"provider.rate-limit","message":"You've hit your usage limit · resets 5pm","status":429}}}}"#)).expect("limit");
        assert_eq!(limit.phase, Some(Phase::Limit));
        assert_eq!(limit.problem.as_ref().map(|p| (p.kind, p.resets.as_deref())), Some((ProblemKind::UsageLimit, Some("5pm"))));

        let busy = run(&mut t, "session.execution.failed", &format!(r#"{{{SES},"error":{{"type":"provider.rate-limit","message":"Too many requests","status":429}}}}"#)).expect("busy");
        assert_eq!((busy.phase, busy.problem.map(|p| p.kind)), (Some(Phase::Error), Some(ProblemKind::Overloaded)));

        let login = run(&mut t, "session.execution.failed", &format!(r#"{{{SES},"error":{{"type":"provider.auth","message":"Invalid API key","status":401}}}}"#)).expect("login");
        assert_eq!(login.problem.map(|p| p.kind), Some(ProblemKind::Login));

        let offline = run(&mut t, "session.execution.failed", &format!(r#"{{{SES},"error":{{"type":"network","message":"connect ECONNREFUSED 127.0.0.1:443"}}}}"#)).expect("offline");
        assert_eq!(offline.problem.map(|p| p.kind), Some(ProblemKind::Connection));
    }

    #[test]
    fn sub_agent_sessions_and_duplicate_events_do_not_show_up() {
        let mut t = Translator::default();
        let child = run(&mut t, "session.created", r#"{"sessionID":"ses_child","parentID":"ses_01JABC","slug":"x","version":"2.2.1"}"#);
        assert!(child.is_none());
        assert!(run(&mut t, "session.execution.started", r#"{"sessionID":"ses_child"}"#).is_none());

        let first = t.translate(&line_with("session.execution.started", r#","id":"evt_1""#, &format!("{{{SES}}}")));
        assert!(first.is_some());
        let second = t.translate(&line_with("session.execution.started", r#","id":"evt_1""#, &format!("{{{SES}}}")));
        assert!(second.is_none(), "a second plugin instance reports the same event again");
        let step = |t: &mut Translator, id: &str| {
            t.translate(&line_with("session.step.ended", &format!(r#","id":"{id}""#), &format!(r#"{{{SES},"tokens":{{"input":0,"output":100,"reasoning":0,"cache":{{"read":0,"write":0}}}}}}"#)))
        };
        assert_eq!(step(&mut t, "evt_2").and_then(|e| e.tokens_out), Some(100));
        assert!(step(&mut t, "evt_2").is_none());
        assert_eq!(step(&mut t, "evt_3").and_then(|e| e.tokens_out), Some(200));
    }

    #[test]
    fn events_the_island_does_not_show_and_malformed_lines_are_skipped() {
        let mut t = Translator::default();
        assert!(run(&mut t, "session.usage.updated", &format!("{{{SES}}}")).is_none());
        assert!(run(&mut t, "session.compaction.started", &format!("{{{SES}}}")).is_none());
        assert!(t.translate(&serde_json::json!({"adapter":"opencode"})).is_none());
        assert!(t.translate(&serde_json::json!({"adapter":"opencode","event":{"type":"session.created"}})).is_none());
        assert!(run(&mut t, "session.execution.started", r#"{"nope":1}"#).is_none());
        let deleted = run(&mut t, "session.deleted", &format!("{{{SES}}}")).expect("deleted");
        assert_eq!(deleted.phase, Some(Phase::Idle));
    }

    #[test]
    fn the_folder_comes_from_the_event_when_a_session_was_seen_only_midway() {
        let mut t = Translator::default();
        let e = run(&mut t, "session.step.started", &format!("{{{SES}}}")).expect("step");
        assert_eq!(e.cwd.as_deref(), Some("D:\\work\\dotDock"));
    }
}

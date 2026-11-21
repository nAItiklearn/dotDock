//! The agent feed: the one way any AI coding agent tells the island what it is doing.
//!
//! An agent appends one JSON object per line to a `*.jsonl` file in the feed folder (`<app data>\agents`).
//! The island follows those files, folds the lines into one session per `(agent, session)` and shows it like
//! any other. GitHub Copilot CLI and OpenCode are two writers of this feed; `docs/ISLAND_PROTOCOL.md` is the
//! contract for everyone else.
//!
//! A line is either a protocol line (`FeedEvent`) or an adapter line, `{"v":1,"adapter":"opencode",...}`, which
//! carries an agent's native event for the island to translate (see `opencode`). Lines that cannot be read are
//! skipped, so a newer or foreign writer never breaks the island.

use crate::describe::{redact_command, DETAIL_LIMIT};
use crate::hook::{first_line, project_name};
use crate::opencode;
use crate::phase::{AgentKind, Phase};
use crate::problem::{Problem, ProblemKind};
use crate::state::SessionState;
use crate::tail::Tail;
use crate::util::{clip, sanitize_id};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// The only protocol version so far. A line that names another one is skipped.
pub const PROTOCOL_VERSION: u64 = 1;
/// Longest line the island parses. Events are a few hundred bytes; anything larger is not an event.
const MAX_LINE_BYTES: usize = 32 * 1024;
/// A first read of a long file starts this far from its end: enough for the current turn.
const FIRST_READ_WINDOW: u64 = 256 * 1024;
const AGENT_ID_LEN: usize = 16;
const SESSION_ID_LEN: usize = 36;
const NAME_LIMIT: usize = 24;
const TITLE_LIMIT: usize = 80;
const MESSAGE_LIMIT: usize = 80;
/// Feed files nobody has written to for this long are deleted.
pub const FILE_MAX_AGE: Duration = Duration::from_secs(24 * 3_600);
const FILE_EXTENSION: &str = "jsonl";

/// One thing an agent reports. Every field but `agent` and `session` is optional.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FeedEvent {
    /// Lower-case id of the agent, up to 16 characters of `a-z`, `0-9`, `-`, `_`.
    pub agent: String,
    /// Display name for an agent the island does not know by id.
    pub name: Option<String>,
    /// The agent's own id for the session; each session is shown separately.
    pub session: String,
    /// When it happened, epoch milliseconds. The time the island read the line stands in when it is missing.
    pub at: Option<u64>,
    pub phase: Option<Phase>,
    /// The tool in use, and the one short thing it works on. Both belong to `phase`.
    pub tool: Option<String>,
    pub detail: Option<String>,
    pub cwd: Option<String>,
    /// Shown instead of the name of `cwd`'s folder.
    pub project: Option<String>,
    pub title: Option<String>,
    /// What was done; first readable line, shown with `done`.
    pub summary: Option<String>,
    /// Output tokens produced in the current turn.
    pub tokens_out: Option<u64>,
    /// Tokens in the context window after the latest reply.
    pub context: Option<u64>,
    pub problem: Option<Problem>,
    /// Process id of the agent. The island marks the session stopped when that process ends.
    pub pid: Option<u32>,
}

fn text<'a>(object: &'a Value, key: &str) -> Option<&'a str> {
    object.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
}

fn count(object: &Value, key: &str) -> Option<u64> {
    object.get(key).and_then(Value::as_u64)
}

/// `Copilot CLI` becomes `copilot-cli`: the id a feed agent is known by.
fn agent_id(raw: &str) -> String {
    raw.trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '-' })
        .take(AGENT_ID_LEN)
        .collect::<String>()
        .trim_matches('-')
        .to_owned()
}

fn problem_of(value: &Value) -> Option<Problem> {
    let message = text(value, "message").map(|m| clip(m, MESSAGE_LIMIT)).unwrap_or_default();
    let kind = value.get("kind").and_then(|k| serde_json::from_value::<ProblemKind>(k.clone()).ok());
    (kind.is_some() || !message.is_empty()).then(|| Problem {
        kind: kind.unwrap_or(ProblemKind::Api),
        message,
        resets: text(value, "resets").map(|r| clip(r, MESSAGE_LIMIT)),
    })
}

impl FeedEvent {
    /// Reads a protocol line. `None` for a line that is not one: wrong version, no agent or session, or an
    /// unknown phase (the line may come from a newer protocol, so it is skipped whole).
    pub fn parse(line: &Value) -> Option<Self> {
        if line.get("v").and_then(Value::as_u64).is_some_and(|v| v != PROTOCOL_VERSION) {
            return None;
        }
        let agent = agent_id(text(line, "agent")?);
        let session: String = sanitize_id(text(line, "session")?).chars().take(SESSION_ID_LEN).collect();
        if agent.is_empty() || session.is_empty() {
            return None;
        }
        let phase = match line.get("phase") {
            None | Some(Value::Null) => None,
            Some(value) => Some(serde_json::from_value::<Phase>(value.clone()).ok()?),
        };
        Some(Self {
            agent,
            name: text(line, "name").map(|n| clip(n, NAME_LIMIT)),
            session,
            at: count(line, "at"),
            phase,
            tool: text(line, "tool").map(|t| clip(t, NAME_LIMIT * 2)),
            detail: text(line, "detail").map(str::to_owned),
            cwd: text(line, "cwd").map(str::to_owned),
            project: text(line, "project").map(|p| clip(p, NAME_LIMIT * 2)),
            title: text(line, "title").map(|t| clip(t, TITLE_LIMIT)),
            summary: text(line, "summary").map(str::to_owned),
            tokens_out: count(line, "tokens_out"),
            context: count(line, "context"),
            problem: line.get("problem").and_then(problem_of),
            pid: count(line, "pid").and_then(|p| u32::try_from(p).ok()),
        })
    }

    /// The protocol line for this event, without the trailing newline.
    pub fn to_line(&self) -> String {
        let mut line = Map::new();
        line.insert("v".into(), json!(PROTOCOL_VERSION));
        line.insert("agent".into(), json!(self.agent));
        line.insert("session".into(), json!(self.session));
        let optional: [(&str, Option<Value>); 13] = [
            ("name", self.name.as_ref().map(|v| json!(v))),
            ("at", self.at.map(|v| json!(v))),
            ("phase", self.phase.map(|v| json!(v))),
            ("tool", self.tool.as_ref().map(|v| json!(v))),
            ("detail", self.detail.as_ref().map(|v| json!(v))),
            ("cwd", self.cwd.as_ref().map(|v| json!(v))),
            ("project", self.project.as_ref().map(|v| json!(v))),
            ("title", self.title.as_ref().map(|v| json!(v))),
            ("summary", self.summary.as_ref().map(|v| json!(v))),
            ("tokens_out", self.tokens_out.map(|v| json!(v))),
            ("context", self.context.map(|v| json!(v))),
            ("problem", self.problem.as_ref().and_then(|p| serde_json::to_value(p).ok())),
            ("pid", self.pid.map(|v| json!(v))),
        ];
        line.extend(optional.into_iter().filter_map(|(key, value)| value.map(|v| (key.to_owned(), v))));
        Value::Object(line).to_string()
    }
}

/// The id a feed session has inside the island. The prefix keeps it apart from Claude Code's and Codex's ids.
pub fn session_id(agent: &str, session: &str) -> String {
    format!("feed-{agent}-{session}")
}

/// Folds one event into the session's state. Pure: the caller supplies the previous state and the clock.
///
/// - A phase starts a turn when the session was not active before; the token count restarts with it.
/// - `tool`, `detail`, `summary` and `problem` replace the previous values whenever a phase arrives.
/// - Everything else (title, folder, tokens, process id) only ever updates what it names.
pub fn reduce(prev: Option<&SessionState>, event: &FeedEvent, now_ms: u64) -> SessionState {
    let id = session_id(&event.agent, &event.session);
    // An event cannot be from the future; a wrong clock must not freeze the session behind a huge stamp. Nor can
    // it be older than the session's last event: lines count in the order they were written, and a clock running
    // behind must not make a working session look quiet for hours and drop it.
    let at = event.at.map_or(now_ms, |t| t.min(now_ms)).max(prev.map_or(0, |p| p.updated_at));
    let mut next = prev.cloned().unwrap_or_else(|| SessionState::new(AgentKind::from_feed_id(&event.agent), &id));
    if next.agent == AgentKind::Other {
        next.agent_name = event.name.clone().or_else(|| next.agent_name.take()).or_else(|| Some(event.agent.clone()));
    }
    if let Some(phase) = event.phase {
        if phase.is_active() && !prev.is_some_and(|p| p.phase.is_active()) {
            next.turn_started_at = Some(at);
            next.tokens_out = Some(0);
        }
        next.phase = phase;
        next.tool = event.tool.clone();
        next.detail = event.detail.as_deref().map(|d| clip(&redact_command(d), DETAIL_LIMIT)).filter(|d| !d.is_empty());
        next.summary = event.summary.as_deref().and_then(first_line).filter(|_| phase == Phase::Done);
        next.problem = event.problem.clone().filter(|_| matches!(phase, Phase::Limit | Phase::Error));
    }
    if let Some(cwd) = &event.cwd {
        next.project = project_name(cwd);
        next.cwd = Some(cwd.clone());
    }
    if let Some(project) = &event.project {
        next.project = project.clone();
    }
    if let Some(title) = &event.title {
        next.title = Some(title.clone());
    }
    if let Some(tokens) = event.tokens_out {
        next.tokens_out = Some(tokens);
    }
    if event.context.is_some() {
        next.context = event.context;
    }
    if event.pid.is_some() {
        next.pid = event.pid;
    }
    next.updated_at = at;
    next.seq = at.saturating_mul(1_000_000).max(next.seq);
    next
}

/// True for `<name>.jsonl`; temp files and anything else in the folder are not feed files.
pub fn is_feed_file(path: &Path) -> bool {
    path.extension().is_some_and(|e| e == FILE_EXTENSION)
        && path.file_name().and_then(|n| n.to_str()).is_some_and(|n| !n.starts_with('.'))
}

/// Appends one protocol line to `<dir>\<file_stem>.jsonl`, creating the folder and file when needed. One
/// `write` call carries the whole line, so writers in separate processes do not interleave.
pub fn append(dir: &Path, file_stem: &str, event: &FeedEvent) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let mut line = event.to_line();
    line.push('\n');
    let path = dir.join(format!("{}.{FILE_EXTENSION}", sanitize_id(file_stem)));
    std::fs::OpenOptions::new().create(true).append(true).open(path)?.write_all(line.as_bytes())
}

/// Feed files written within `window`. Used at startup to pick up sessions that are running right now.
pub fn recent_files(dir: &Path, window: Duration) -> Vec<PathBuf> {
    let now = SystemTime::now();
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| is_feed_file(p))
        .filter(|p| {
            std::fs::metadata(p)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| now.duration_since(t).ok())
                .is_some_and(|age| age <= window)
        })
        .collect()
}

/// Deletes feed files not written to for `max_age`. Returns how many went.
pub fn prune(dir: &Path, max_age: Duration) -> usize {
    let now = SystemTime::now();
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| is_feed_file(p))
        .filter(|p| {
            std::fs::metadata(p)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| now.duration_since(t).ok())
                .is_some_and(|age| age > max_age)
        })
        .filter(|p| std::fs::remove_file(p).is_ok())
        .count()
}

#[derive(Default)]
struct FeedFile {
    tail: Tail,
    opencode: opencode::Translator,
}

impl FeedFile {
    fn translate(&mut self, line: &Value) -> Option<FeedEvent> {
        match text(line, "adapter") {
            None => FeedEvent::parse(line),
            Some("opencode") if line.get("v").and_then(Value::as_u64).is_none_or(|v| v == PROTOCOL_VERSION) => {
                self.opencode.translate(line)
            }
            Some(_) => None,
        }
    }
}

/// Follows every feed file and keeps the folded session of each `(agent, session)`.
#[derive(Default)]
pub struct FeedReader {
    files: HashMap<PathBuf, FeedFile>,
    sessions: HashMap<String, SessionState>,
}

impl FeedReader {
    pub fn new() -> Self {
        Self::default()
    }

    /// Reads what was appended to `path` since last time. Returns the sessions whose state changed.
    pub fn read(&mut self, path: &Path, now_ms: u64) -> Vec<SessionState> {
        if !is_feed_file(path) {
            return Vec::new();
        }
        let Self { files, sessions } = self;
        let file = files.entry(path.to_owned()).or_default();
        let Some(lines) = file.tail.read_lines(path, FIRST_READ_WINDOW) else { return Vec::new() };
        let mut changed: Vec<String> = Vec::new();
        for line in lines.iter().filter(|l| l.len() <= MAX_LINE_BYTES) {
            let Some(event) = serde_json::from_str::<Value>(line).ok().and_then(|v| file.translate(&v)) else {
                continue;
            };
            let id = session_id(&event.agent, &event.session);
            let next = reduce(sessions.get(&id), &event, now_ms);
            if sessions.get(&id) != Some(&next) {
                sessions.insert(id.clone(), next);
                if !changed.contains(&id) {
                    changed.push(id);
                }
            }
        }
        changed.iter().filter_map(|id| sessions.get(id).cloned()).collect()
    }

    /// Stops following a file that was deleted.
    pub fn forget(&mut self, path: &Path) {
        self.files.remove(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_795_062_700_000;

    fn parse(line: &str) -> Option<FeedEvent> {
        FeedEvent::parse(&serde_json::from_str(line).expect("json"))
    }

    fn event(json: &str) -> FeedEvent {
        parse(json).unwrap_or_else(|| panic!("not a protocol line: {json}"))
    }

    #[test]
    fn a_full_protocol_line_is_read_field_by_field() {
        let e = event(
            r#"{"v":1,"agent":"Aider","name":"Aider","session":"s-1","at":1795062601000,"phase":"running","tool":"shell","detail":"pytest -q","cwd":"D:\\work\\dotDock","project":"dotDock","title":"Fix header","summary":"Done it","tokens_out":812,"context":40960,"problem":{"kind":"usage_limit","message":"Session limit","resets":"5pm"},"pid":4242}"#,
        );
        assert_eq!((e.agent.as_str(), e.session.as_str(), e.at), ("aider", "s-1", Some(1_795_062_601_000)));
        assert_eq!(
            (e.phase, e.tool.as_deref(), e.detail.as_deref()),
            (Some(Phase::Running), Some("shell"), Some("pytest -q"))
        );
        assert_eq!((e.tokens_out, e.context, e.pid), (Some(812), Some(40_960), Some(4_242)));
        let problem = e.problem.expect("problem");
        assert_eq!((problem.kind, problem.resets.as_deref()), (ProblemKind::UsageLimit, Some("5pm")));
    }

    #[test]
    fn only_agent_and_session_are_required() {
        let e = event(r#"{"agent":"my agent!","session":"../x y"}"#);
        assert_eq!((e.agent.as_str(), e.session.as_str(), e.phase), ("my-agent", "xy", None));
    }

    #[test]
    fn unreadable_lines_are_skipped_not_guessed() {
        assert!(parse(r#"{"v":2,"agent":"a","session":"s"}"#).is_none(), "another protocol version");
        assert!(parse(r#"{"agent":"a"}"#).is_none(), "no session");
        assert!(parse(r#"{"session":"s"}"#).is_none(), "no agent");
        assert!(parse(r#"{"agent":"a","session":"s","phase":"dancing"}"#).is_none(), "unknown phase");
        assert!(parse(r#"{"agent":"!!!","session":"s"}"#).is_none(), "an agent id with nothing usable in it");
    }

    #[test]
    fn a_wrongly_typed_field_never_costs_the_whole_line() {
        let e = event(r#"{"agent":"a","session":"s","phase":"thinking","detail":42,"tokens_out":"many","pid":-1}"#);
        assert_eq!((e.phase, e.detail, e.tokens_out, e.pid), (Some(Phase::Thinking), None, None, None));
    }

    #[test]
    fn a_line_round_trips_through_the_writer() {
        let original = FeedEvent {
            agent: "copilot".into(),
            session: "abc".into(),
            at: Some(5),
            phase: Some(Phase::Error),
            detail: Some("x".into()),
            problem: Some(Problem { kind: ProblemKind::Login, message: "Signed out".into(), resets: None }),
            pid: Some(7),
            ..FeedEvent::default()
        };
        assert_eq!(event(&original.to_line()), original);
        assert!(!original.to_line().contains('\n'), "one event is one line");
    }

    fn reduce_all(events: &[&str]) -> SessionState {
        events.iter().fold(None, |prev, e| Some(reduce(prev.as_ref(), &event(e), NOW))).expect("state")
    }

    #[test]
    fn a_turn_starts_with_the_first_active_phase_and_ends_with_done() {
        let s = reduce_all(&[
            r#"{"agent":"aider","session":"s","at":1000,"cwd":"D:\\work\\dotDock","pid":9}"#,
            r#"{"agent":"aider","session":"s","at":2000,"phase":"thinking"}"#,
            r#"{"agent":"aider","session":"s","at":3000,"phase":"editing","tool":"edit","detail":"main.rs","tokens_out":120}"#,
        ]);
        assert_eq!((s.phase, s.turn_started_at, s.tokens_out), (Phase::Editing, Some(2_000), Some(120)));
        assert_eq!(
            (s.project.as_str(), s.pid, s.agent, s.agent_name.as_deref()),
            ("dotDock", Some(9), AgentKind::Other, Some("aider"))
        );
        assert_eq!(s.session_id, "feed-aider-s");
        let done = reduce(
            Some(&s),
            &event(
                r#"{"agent":"aider","session":"s","at":4000,"phase":"done","summary":"**Fixed** the header layout.\nMore."}"#,
            ),
            NOW,
        );
        assert_eq!(
            (done.phase, done.summary.as_deref(), done.detail.as_deref(), done.tool.as_deref()),
            (Phase::Done, Some("Fixed the header layout."), None, None)
        );
        assert_eq!(done.turn_started_at, Some(2_000), "the finished turn keeps its start");
        let next_turn =
            reduce(Some(&done), &event(r#"{"agent":"aider","session":"s","at":9000,"phase":"thinking"}"#), NOW);
        assert_eq!((next_turn.turn_started_at, next_turn.tokens_out, next_turn.summary), (Some(9_000), Some(0), None));
    }

    #[test]
    fn known_agents_get_their_kind_and_others_their_own_name() {
        let s = reduce_all(&[r#"{"agent":"copilot","session":"s","phase":"thinking"}"#]);
        assert_eq!(
            (s.agent, s.agent_name.as_deref(), s.agent_label()),
            (AgentKind::Copilot, None, "GitHub Copilot CLI".to_owned())
        );
        let s = reduce_all(&[r#"{"agent":"my-agent","name":"My Agent","session":"s","phase":"thinking"}"#]);
        assert_eq!(s.agent_label(), "My Agent");
        let s = reduce_all(&[r#"{"agent":"codex","session":"s","phase":"thinking"}"#]);
        assert_eq!((s.agent, s.session_id.as_str()), (AgentKind::Other, "feed-codex-s"));
    }

    #[test]
    fn problems_only_stick_to_limit_and_error_and_details_are_masked() {
        let s = reduce_all(&[
            r#"{"agent":"a","session":"s","phase":"running","detail":"deploy --token s3cr3t --env prod"}"#,
        ]);
        assert_eq!(s.detail.as_deref(), Some("deploy --token … --env prod"));
        let limit = reduce_all(&[
            r#"{"agent":"a","session":"s","phase":"limit","problem":{"kind":"usage_limit","message":"Session limit","resets":"5pm"}}"#,
        ]);
        assert_eq!(limit.problem.as_ref().map(|p| p.kind), Some(ProblemKind::UsageLimit));
        let recovered = reduce(
            Some(&limit),
            &event(r#"{"agent":"a","session":"s","phase":"thinking","problem":{"message":"stale"}}"#),
            NOW,
        );
        assert_eq!(recovered.problem, None);
    }

    #[test]
    fn the_clock_of_a_writer_cannot_freeze_a_session() {
        let far_future = event(r#"{"agent":"a","session":"s","at":99999999999999,"phase":"thinking"}"#);
        let s = reduce(None, &far_future, NOW);
        assert_eq!(s.updated_at, NOW);
        let later =
            reduce(Some(&s), &event(r#"{"agent":"a","session":"s","at":1795062650000,"phase":"reading"}"#), NOW + 1);
        assert_eq!(later.phase, Phase::Reading);
        assert!(later.seq >= s.seq, "stamps never go backwards");
    }

    #[test]
    fn a_clock_running_behind_never_makes_a_working_session_look_old() {
        let working = reduce(None, &event(r#"{"agent":"a","session":"s","at":5000,"phase":"running"}"#), NOW);
        let behind = reduce(Some(&working), &event(r#"{"agent":"a","session":"s","at":1,"phase":"reading"}"#), NOW);
        assert_eq!((behind.phase, behind.updated_at), (Phase::Reading, 5_000), "written later, so it counts later");
        let fresh = reduce(None, &event(r#"{"agent":"a","session":"t","at":1,"phase":"reading"}"#), NOW);
        assert_eq!(fresh.updated_at, 1, "a session's first line keeps its own time, so old history stays old");
    }

    #[test]
    fn a_line_without_a_time_is_stamped_with_the_time_it_was_read() {
        assert_eq!(reduce(None, &event(r#"{"agent":"a","session":"s","phase":"thinking"}"#), NOW).updated_at, NOW);
    }

    fn write_feed(dir: &Path, name: &str, lines: &[&str]) -> PathBuf {
        let path = dir.join(name);
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&path).expect("open");
        for line in lines {
            writeln!(file, "{line}").expect("write");
        }
        path
    }

    #[test]
    fn the_reader_follows_a_file_and_reports_only_changed_sessions() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_feed(
            dir.path(),
            "aider.jsonl",
            &[
                r#"{"agent":"aider","session":"a","at":1000,"phase":"thinking"}"#,
                r#"{"agent":"aider","session":"b","at":1100,"phase":"running","detail":"ls"}"#,
                "not json at all",
                r#"{"agent":"aider","session":"a","at":1200,"phase":"reading","detail":"lib.rs"}"#,
            ],
        );
        let mut reader = FeedReader::new();
        let mut states = reader.read(&path, NOW);
        states.sort_by(|x, y| x.session_id.cmp(&y.session_id));
        let summary: Vec<_> = states.iter().map(|s| (s.session_id.as_str(), s.phase)).collect();
        assert_eq!(summary, vec![("feed-aider-a", Phase::Reading), ("feed-aider-b", Phase::Running)]);
        assert!(reader.read(&path, NOW).is_empty(), "nothing new");
        write_feed(dir.path(), "aider.jsonl", &[r#"{"agent":"aider","session":"b","at":1300,"phase":"done"}"#]);
        let states = reader.read(&path, NOW);
        assert_eq!(states.len(), 1);
        assert_eq!((states[0].session_id.as_str(), states[0].phase), ("feed-aider-b", Phase::Done));
    }

    #[test]
    fn oversized_lines_and_foreign_files_are_ignored() {
        let dir = tempfile::tempdir().expect("tempdir");
        let huge =
            format!(r#"{{"agent":"a","session":"s","phase":"thinking","detail":"{}"}}"#, "x".repeat(MAX_LINE_BYTES));
        let path = write_feed(dir.path(), "a.jsonl", &[&huge]);
        let mut reader = FeedReader::new();
        assert!(reader.read(&path, NOW).is_empty());
        let other = write_feed(dir.path(), "a.txt", &[r#"{"agent":"a","session":"s","phase":"thinking"}"#]);
        assert!(reader.read(&other, NOW).is_empty(), "only .jsonl files are feed files");
        let hidden = write_feed(dir.path(), ".a.jsonl", &[r#"{"agent":"a","session":"s","phase":"thinking"}"#]);
        assert!(reader.read(&hidden, NOW).is_empty(), "dot files are temp files");
    }

    #[test]
    fn writers_in_one_folder_never_interleave_their_lines() {
        let dir = tempfile::tempdir().expect("tempdir");
        let feed = dir.path().join("agents");
        let handles: Vec<_> = (0..4)
            .map(|worker| {
                let feed = feed.clone();
                std::thread::spawn(move || {
                    for n in 0..25 {
                        let event = FeedEvent {
                            agent: "aider".into(),
                            session: "s".into(),
                            at: Some(1_000 + n),
                            phase: Some(Phase::Thinking),
                            detail: Some(format!("worker {worker} step {n}")),
                            ..FeedEvent::default()
                        };
                        append(&feed, "shared", &event).expect("append");
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().expect("worker");
        }
        let text = std::fs::read_to_string(feed.join("shared.jsonl")).expect("read");
        assert_eq!(text.lines().count(), 100);
        assert!(text.lines().all(|l| serde_json::from_str::<Value>(l).is_ok()), "every line is whole JSON");
    }

    #[test]
    fn recent_files_and_prune_follow_the_file_age() {
        let dir = tempfile::tempdir().expect("tempdir");
        let fresh = write_feed(dir.path(), "fresh.jsonl", &["{}"]);
        let old = write_feed(dir.path(), "old.jsonl", &["{}"]);
        write_feed(dir.path(), "notes.txt", &["x"]);
        let two_days_ago = SystemTime::now() - Duration::from_secs(2 * 86_400);
        std::fs::OpenOptions::new().write(true).open(&old).expect("open").set_modified(two_days_ago).expect("mtime");
        assert_eq!(recent_files(dir.path(), Duration::from_secs(600)), vec![fresh.clone()]);
        assert_eq!(prune(dir.path(), FILE_MAX_AGE), 1);
        assert!(fresh.exists() && !old.exists());
        assert!(dir.path().join("notes.txt").exists(), "files that are not feed files are never deleted");
    }

    #[test]
    fn opencode_adapter_lines_and_protocol_lines_share_a_file_and_a_reader() {
        let dir = tempfile::tempdir().expect("tempdir");
        let at = |kind: &str, data: &str| {
            format!(
                r#"{{"v":1,"adapter":"opencode","pid":4242,"event":{{"type":"{kind}","created":1795062601000,"location":{{"directory":"D:\\work\\dotDock"}},"data":{data}}}}}"#
            )
        };
        let path = write_feed(
            dir.path(),
            "opencode-4242.jsonl",
            &[
                &at("session.created", r#"{"sessionID":"ses_1","title":"Fix the header"}"#),
                &at("session.execution.started", r#"{"sessionID":"ses_1"}"#),
                &at("session.tool.input.started", r#"{"sessionID":"ses_1","id":"c1","name":"edit"}"#),
                &at("session.tool.called", r#"{"sessionID":"ses_1","id":"c1","input":{"filePath":"C:\\x\\app.css"}}"#),
                r#"{"agent":"aider","session":"s","at":1000,"phase":"thinking"}"#,
            ],
        );
        let mut reader = FeedReader::new();
        let mut states = reader.read(&path, NOW);
        states.sort_by(|a, b| a.session_id.cmp(&b.session_id));
        let by_id = |id: &str| states.iter().find(|s| s.session_id == id).unwrap_or_else(|| panic!("no {id}"));
        let opencode = by_id("feed-opencode-ses_1");
        assert_eq!(
            (opencode.agent, opencode.phase, opencode.detail.as_deref()),
            (AgentKind::OpenCode, Phase::Editing, Some("app.css"))
        );
        assert_eq!(
            (opencode.project.as_str(), opencode.title.as_deref(), opencode.pid),
            ("dotDock", Some("Fix the header"), Some(4_242))
        );
        assert_eq!(by_id("feed-aider-s").phase, Phase::Thinking);
    }

    #[test]
    fn unknown_adapters_are_skipped() {
        let mut file = FeedFile::default();
        let line: Value = serde_json::from_str(r#"{"v":1,"adapter":"future-agent","event":{}}"#).expect("json");
        assert_eq!(file.translate(&line), None);
    }
}

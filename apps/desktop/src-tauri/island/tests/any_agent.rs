//! Every agent the island supports, at the same time, through the island's own readers.
//!
//! The fixtures are recorded sessions in each agent's native shape, each with malformed lines mixed in:
//! - `claude-hooks.jsonl`: Claude Code hook payloads for two sessions in two folders (`{"at", "input"}` per line);
//! - `codex-rollout.jsonl`: a Codex rollout log;
//! - `copilot-hooks.jsonl`: GitHub Copilot CLI hook payloads (`{"event", "payload"}` per line);
//! - `opencode-feed.jsonl`: what the OpenCode plugin writes (see `opencode_feed.rs`);
//! - `generic-feed.jsonl`: an agent with no adapter speaking the feed protocol (`docs/ISLAND_PROTOCOL.md`).
//!
//! `tools/island-replay.mjs` plays the same files onto the real desktop for the live test.

use dotdock_island::codex::CodexReader;
use dotdock_island::engine::{AlertKind, Engine, EngineConfig, Snapshot};
use dotdock_island::feed::{self, FeedReader};
use dotdock_island::hook::{self, HookEnv, HookInput};
use dotdock_island::phase::{AgentKind, Phase};
use dotdock_island::problem::ProblemKind;
use dotdock_island::SessionState;
use serde_json::Value;
use std::io::Write;
use std::path::{Path, PathBuf};

const CLAUDE_PID: u32 = 7_170;
const COPILOT_PID: u32 = 6_160;
const CODEX_ID: &str = "codex-01a04e65-47c8-70c1-b898-8d5452cb24b0";
const COPILOT_ID: &str = "feed-copilot-c0p1lot-7f3e";
const OPENCODE_ID: &str = "feed-opencode-ses_01JABC";
const GENERIC_ID: &str = "feed-aider-aider-9b2";
/// Every session is mid-turn here: Claude asks for permission, Copilot waits, the others work.
const MIDWAY: u64 = 1_795_062_606_500;

fn fixture(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join(name);
    std::fs::read_to_string(path).expect("fixture")
}

fn append_line(path: &Path, line: &str) {
    std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path).expect("open");
    writeln!(file, "{line}").expect("append");
}

/// What every reader produced, stamped with the moment it happened.
fn timeline(dir: &Path) -> Vec<(u64, SessionState)> {
    let mut out = Vec::new();

    let mut claude: std::collections::HashMap<String, SessionState> = Default::default();
    for line in fixture("claude-hooks.jsonl").lines() {
        let Ok(record) = serde_json::from_str::<Value>(line) else { continue };
        let at = record["at"].as_u64().expect("at");
        let Ok(input) = serde_json::from_value::<HookInput>(record["input"].clone()) else { continue };
        let env =
            HookEnv { now_ms: at, now_ns: at * 1_000_000, parent: Some((CLAUDE_PID, None)), ..HookEnv::default() };
        let id = input.session_id.clone().unwrap_or_default();
        if let Some(next) = hook::apply(claude.get(&id), &input, &env) {
            claude.insert(id, next.clone());
            out.push((at, next));
        }
    }

    let rollout = dir.join("codex").join("2026").join("11").join("19");
    let rollout = rollout.join("rollout-2026-11-19T10-00-00-01a04e65-47c8-70c1-b898-8d5452cb24b0.jsonl");
    let mut codex = CodexReader::new();
    for line in fixture("codex-rollout.jsonl").lines() {
        append_line(&rollout, line);
        if let Some(update) = codex.read(&rollout) {
            out.push((update.state.updated_at, update.state));
        }
    }

    // The three feed writers share one folder, as they do on a real machine.
    let feed_dir = dir.join("agents");
    let mut reader = FeedReader::new();
    let mut clock = 0;
    let mut read_feed = |reader: &mut FeedReader, path: &Path, at: Option<u64>, out: &mut Vec<(u64, SessionState)>| {
        clock = at.unwrap_or(clock);
        out.extend(reader.read(path, clock).into_iter().map(|s| (s.updated_at, s)));
    };
    for line in fixture("copilot-hooks.jsonl").lines() {
        let Ok(record) = serde_json::from_str::<Value>(line) else { continue };
        let event = record["event"].as_str().expect("event");
        let Some(translated) = dotdock_island::copilot::translate(event, &record["payload"], Some(COPILOT_PID)) else {
            continue;
        };
        feed::append(&feed_dir, "copilot-c0p1lot-7f3e", &translated).expect("spool");
        read_feed(&mut reader, &feed_dir.join("copilot-c0p1lot-7f3e.jsonl"), translated.at, &mut out);
    }
    for (name, file) in [("opencode-feed.jsonl", "opencode-4242.jsonl"), ("generic-feed.jsonl", "aider-5150.jsonl")] {
        let path = feed_dir.join(file);
        for line in fixture(name).lines() {
            append_line(&path, line);
            let at = serde_json::from_str::<Value>(line)
                .ok()
                .and_then(|v| v["at"].as_u64().or_else(|| v.pointer("/event/created").and_then(Value::as_u64)));
            read_feed(&mut reader, &path, at, &mut out);
        }
    }

    out.sort_by_key(|(at, _)| *at);
    out
}

/// The engine after every event up to `until`, in the order they happened.
fn engine_until(timeline: &[(u64, SessionState)], until: u64) -> Engine {
    let mut engine = Engine::new(EngineConfig::default());
    for (_, state) in timeline.iter().filter(|(at, _)| *at <= until) {
        engine.apply_state(state.clone());
    }
    engine
}

fn view<'a>(snapshot: &'a Snapshot, id: &str) -> &'a dotdock_island::engine::SessionView {
    snapshot.sessions.iter().find(|v| v.id == id).unwrap_or_else(|| panic!("{id} is not on the island"))
}

#[test]
fn six_sessions_of_five_agents_are_shown_side_by_side() {
    let dir = tempfile::tempdir().expect("tempdir");
    let timeline = timeline(dir.path());
    let mut engine = engine_until(&timeline, MIDWAY);
    let (snapshot, alerts) = engine.snapshot(MIDWAY);
    assert_eq!(snapshot.sessions.len(), 6, "{:#?}", snapshot.sessions.iter().map(|v| &v.id).collect::<Vec<_>>());

    let alpha = view(&snapshot, "cl-alpha");
    assert_eq!((alpha.agent, alpha.phase, alpha.project.as_str()), (AgentKind::Claude, Phase::Waiting, "dotDock"));
    assert_eq!(alpha.detail.as_deref(), Some("Claude needs your permission to use Edit"));
    let beta = view(&snapshot, "cl-beta");
    assert_eq!(
        (beta.phase, beta.detail.as_deref(), beta.project.as_str()),
        (Phase::Running, Some("Build the site"), "website")
    );

    let codex = view(&snapshot, CODEX_ID);
    assert_eq!((codex.agent, codex.phase, codex.tokens_out), (AgentKind::Codex, Phase::Thinking, 388));
    assert_eq!(codex.title.as_deref(), Some("Make the clock widget follow the 24-hour…"));

    let copilot = view(&snapshot, COPILOT_ID);
    assert_eq!((copilot.agent, copilot.phase), (AgentKind::Copilot, Phase::Waiting));
    assert_eq!(copilot.detail.as_deref(), Some("Allow edit of Settings.css?"));

    let opencode = view(&snapshot, OPENCODE_ID);
    assert_eq!((opencode.agent, opencode.phase, opencode.tokens_out), (AgentKind::OpenCode, Phase::Running, 412));

    let generic = view(&snapshot, GENERIC_ID);
    assert_eq!((generic.agent, generic.agent_label.as_str()), (AgentKind::Other, "Aider"));
    assert_eq!((generic.phase, generic.detail.as_deref()), (Phase::Editing, Some("Dock.css")));
    assert_eq!((generic.tokens_out, generic.context_tokens), (512, Some(20_480)), "a mistyped count is ignored");

    let waiting: Vec<&str> =
        alerts.iter().filter(|a| a.kind == AlertKind::Waiting).map(|a| a.session_id.as_str()).collect();
    assert_eq!(waiting.len(), 2, "one chime per agent that needs you: {waiting:?}");
}

#[test]
fn malformed_lines_never_move_a_session() {
    let dir = tempfile::tempdir().expect("tempdir");
    let timeline = timeline(dir.path());
    let generic: Vec<&SessionState> =
        timeline.iter().filter(|(_, s)| s.session_id == GENERIC_ID).map(|(_, s)| s).collect();
    let phases: Vec<Phase> = generic.iter().map(|s| s.phase).collect();
    assert_eq!(
        phases,
        [
            Phase::Thinking,
            Phase::Reading,
            Phase::Searching,
            Phase::Searching,
            Phase::Editing,
            Phase::Waiting,
            Phase::Running,
            Phase::Running,
            Phase::Done
        ],
        "the unknown phase, the future version and the cut-off line changed nothing"
    );
    let running = generic.iter().find(|s| s.phase == Phase::Running).expect("running");
    assert!(!running.detail.as_deref().unwrap_or("").contains("abc123"), "the token in the command is masked");

    assert!(
        timeline.iter().all(|(_, s)| !s.session_id.is_empty()),
        "the Copilot payload without a session was dropped"
    );
    let claude_events = timeline.iter().filter(|(_, s)| s.agent == AgentKind::Claude).count();
    assert_eq!(claude_events, 9, "the non-object payload and the unknown hook event were skipped");
}

#[test]
fn every_turn_ends_the_way_the_agent_ended_it() {
    let dir = tempfile::tempdir().expect("tempdir");
    let timeline = timeline(dir.path());
    let engine = engine_until(&timeline, u64::MAX);
    let state = |id: &str| engine.state_of(id).unwrap_or_else(|| panic!("{id}")).clone();

    let alpha = state("cl-alpha");
    assert_eq!(
        (alpha.phase, alpha.summary.as_deref()),
        (Phase::Done, Some("Done. The island border now uses the hairline token."))
    );
    let beta = state("cl-beta");
    let problem = beta.problem.expect("limit");
    assert_eq!(
        (beta.phase, problem.kind, problem.resets.as_deref()),
        (Phase::Limit, ProblemKind::UsageLimit, Some("5pm"))
    );

    let codex = state(CODEX_ID);
    assert_eq!((codex.phase, codex.tokens_out), (Phase::Done, Some(1_204)));
    assert_eq!(codex.summary.as_deref(), Some("The clock now follows the 24-hour setting."));

    let copilot = state(COPILOT_ID);
    assert_eq!(copilot.phase, Phase::Stopped, "the user closed the CLI after the limit");
    let copilot_phases: Vec<Phase> =
        timeline.iter().filter(|(_, s)| s.session_id == COPILOT_ID).map(|(_, s)| s.phase).collect();
    assert!(copilot_phases.contains(&Phase::Done) && copilot_phases.contains(&Phase::Limit));
    assert!(!copilot_phases.contains(&Phase::Error), "the recoverable error was not shown");

    let opencode = state(OPENCODE_ID);
    assert_eq!((opencode.phase, opencode.problem.map(|p| p.kind)), (Phase::Limit, Some(ProblemKind::UsageLimit)));

    let generic = state(GENERIC_ID);
    assert_eq!((generic.phase, generic.tokens_out), (Phase::Done, Some(1_310)));
    assert_eq!(generic.summary.as_deref(), Some("Focus rings added to every dock item."));
}

#[test]
fn a_crashed_agent_shows_stopped_and_leaves_the_others_alone() {
    let dir = tempfile::tempdir().expect("tempdir");
    let timeline = timeline(dir.path());
    let mut engine = engine_until(&timeline, MIDWAY);
    let targets = engine.liveness_targets();
    for id in ["cl-alpha", "cl-beta", COPILOT_ID, OPENCODE_ID, GENERIC_ID] {
        assert!(targets.iter().any(|(t, _, _)| t == id), "{id} is watched for a crash");
    }
    assert!(!targets.iter().any(|(t, _, _)| t == CODEX_ID), "Codex logs carry no process; it goes stale instead");

    engine.set_alive(GENERIC_ID, false, MIDWAY);
    engine.set_alive("cl-beta", false, MIDWAY);
    let (snapshot, _) = engine.snapshot(MIDWAY + 1);
    assert_eq!(view(&snapshot, GENERIC_ID).phase, Phase::Stopped);
    assert_eq!(view(&snapshot, "cl-beta").phase, Phase::Stopped);
    assert_eq!(view(&snapshot, "cl-alpha").phase, Phase::Waiting);
    assert_eq!(view(&snapshot, COPILOT_ID).phase, Phase::Waiting);

    let (later, _) = engine.snapshot(MIDWAY + EngineConfig::default().linger_stopped_ms + 1);
    assert!(later.sessions.iter().all(|v| v.id != GENERIC_ID && v.id != "cl-beta"), "stopped sessions collapse");
    assert_eq!(later.sessions.len(), 4);
}

#[test]
fn a_quiet_session_without_a_process_goes_stale() {
    let dir = tempfile::tempdir().expect("tempdir");
    let timeline = timeline(dir.path());
    let mut engine = engine_until(&timeline, MIDWAY);
    let stale = MIDWAY + EngineConfig::default().stale_ms + 1;
    let (snapshot, _) = engine.snapshot(stale);
    assert!(snapshot.sessions.iter().all(|v| v.id != CODEX_ID), "a Codex turn that stopped writing is dropped");
}

#[test]
fn the_state_tour_shows_every_phase_in_turn() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("agents").join("tour.jsonl");
    let mut reader = FeedReader::new();
    let mut engine = Engine::new(EngineConfig::default());
    let mut seen = Vec::new();
    for line in fixture("generic-states.jsonl").lines() {
        append_line(&path, line);
        let at = serde_json::from_str::<Value>(line).expect("json")["at"].as_u64().expect("at");
        for state in reader.read(&path, at) {
            engine.apply_state(state);
        }
        let (snapshot, _) = engine.snapshot(at);
        let tour = view(&snapshot, "feed-aider-tour-1");
        seen.push(tour.phase);
        if tour.phase == Phase::Limit || tour.phase == Phase::Error {
            assert!(tour.problem.is_some(), "{:?} carries its problem", tour.phase);
        }
    }
    use Phase::*;
    assert_eq!(seen, [Thinking, Reading, Searching, Editing, Running, Waiting, Done, Paused, Limit, Error, Stopped]);
}

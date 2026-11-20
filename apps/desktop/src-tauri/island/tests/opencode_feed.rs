//! The OpenCode plugin's real output, replayed through the island's feed reader.
//!
//! `fixtures/opencode-events.json` is a session as OpenCode 2's public event stream delivers it (with the bulky
//! and private fields a real stream carries); `fixtures/opencode-feed.jsonl` is what `assets/opencode-plugin.js`
//! wrote for it when run under Node. `src/island/opencodePlugin.test.ts` regenerates the second from the first on
//! every test run, so the two cannot drift; this test checks what the island makes of the result.

use dotdock_island::feed::FeedReader;
use dotdock_island::phase::{AgentKind, Phase};
use dotdock_island::problem::ProblemKind;
use std::path::PathBuf;

/// The moment the island reads the feed: after every event in the fixture.
const NOW: u64 = 1_795_062_700_000;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join(name)
}

/// Replays the feed one line at a time, as the island sees a file that grows, and keeps what each line changed.
fn replay() -> Vec<(usize, dotdock_island::SessionState)> {
    let text = std::fs::read_to_string(fixture("opencode-feed.jsonl")).expect("golden feed");
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("opencode-4242.jsonl");
    let mut reader = FeedReader::new();
    let mut seen = Vec::new();
    let now = NOW;
    for (number, line) in text.lines().enumerate() {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&path).expect("open");
        writeln!(file, "{line}").expect("append");
        seen.extend(reader.read(&path, now).into_iter().map(|state| (number + 1, state)));
    }
    seen
}

fn at(seen: &[(usize, dotdock_island::SessionState)], line: usize) -> &dotdock_island::SessionState {
    &seen.iter().find(|(n, _)| *n == line).unwrap_or_else(|| panic!("line {line} changed nothing")).1
}

#[test]
fn the_session_moves_through_the_phases_the_user_would_see() {
    let seen = replay();
    let s = at(&seen, 1);
    assert_eq!((s.session_id.as_str(), s.agent, s.phase), ("feed-opencode-ses_01JABC", AgentKind::OpenCode, Phase::Idle));
    assert_eq!((s.title.as_deref(), s.project.as_str(), s.pid), (Some("Fix the header layout"), "dotDock", Some(4_242)));

    let s = at(&seen, 2);
    assert_eq!((s.phase, s.turn_started_at), (Phase::Thinking, Some(1_795_062_601_000)));

    let s = at(&seen, 6);
    assert_eq!((s.phase, s.tool.as_deref(), s.detail.as_deref()), (Phase::Reading, Some("Read"), Some("header.css")));

    let s = at(&seen, 9);
    assert_eq!((s.tokens_out, s.context), (Some(412), Some(12_412)));

    let s = at(&seen, 11);
    assert_eq!((s.phase, s.detail.as_deref()), (Phase::Waiting, Some("shell: cargo test -p island")));
    assert_eq!(at(&seen, 12).phase, Phase::Thinking, "answered");

    let s = at(&seen, 13);
    assert_eq!((s.phase, s.detail.as_deref()), (Phase::Running, Some("Run the island tests")));

    let s = at(&seen, 17);
    assert_eq!((s.phase, s.summary.as_deref()), (Phase::Done, Some("Fixed the header layout.")));
    assert_eq!(s.tokens_out, Some(500), "412 + 88 output tokens");
}

#[test]
fn a_rate_limit_ends_the_next_turn_with_the_reset_time() {
    let seen = replay();
    let started = at(&seen, 20);
    assert_eq!((started.phase, started.tokens_out, started.turn_started_at), (Phase::Thinking, Some(0), Some(1_795_062_620_000)));
    let failed = at(&seen, 21);
    assert_eq!(failed.phase, Phase::Limit);
    let problem = failed.problem.as_ref().expect("problem");
    assert_eq!((problem.kind, problem.resets.as_deref()), (ProblemKind::UsageLimit, Some("5pm")));
}

#[test]
fn the_sub_agent_session_never_appears() {
    let seen = replay();
    assert!(seen.iter().all(|(_, s)| s.session_id == "feed-opencode-ses_01JABC"));
    assert!(!seen.iter().any(|(n, _)| *n == 18 || *n == 19), "lines 18 and 19 belong to the child session");
}

#[test]
fn nothing_private_survives_into_the_island() {
    let seen = replay();
    let shown = serde_json::to_string(&seen.iter().map(|(_, s)| s).collect::<Vec<_>>()).expect("json");
    for secret in ["PRIVATE", "sk-abcdef", "#ff0000"] {
        assert!(!shown.contains(secret), "{secret} reached the island");
    }
}

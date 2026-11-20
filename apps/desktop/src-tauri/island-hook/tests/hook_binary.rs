//! Runs the real `dotdock-island-hook` executable the way the agents do: arguments on the command line, one
//! event as JSON on stdin, and always exit code 0.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

const HOOK: &str = env!("CARGO_BIN_EXE_dotdock-island-hook");
const SESSION: &str = "3f1c8e52-93d6-4c61-8d0a-6b1e2f7a9c10";

fn run(args: &[&str], env: &[(&str, &Path)], stdin: &str) -> std::process::Output {
    let mut command = Command::new(HOOK);
    command.args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for (key, value) in env {
        command.env(key, value);
    }
    let mut child = command.spawn().expect("start the hook");
    child.stdin.take().expect("stdin").write_all(stdin.as_bytes()).expect("write stdin");
    child.wait_with_output().expect("hook output")
}

fn copilot_args<'a>(event: &'a str, spool: &'a str) -> Vec<&'a str> {
    vec!["--agent", "copilot", "--event", event, "--spool", spool]
}

#[test]
fn a_copilot_event_becomes_one_feed_line_and_nothing_is_printed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let spool = dir.path().join("agents");
    let spool_arg = spool.to_str().expect("utf-8 path");
    let payload = format!(
        r#"{{"sessionId":"{SESSION}","timestamp":1795062601000,"cwd":"D:\\work\\dotDock","toolName":"view","toolArgs":{{"path":"D:\\work\\dotDock\\src\\lib.rs"}}}}"#
    );
    let out = run(&copilot_args("preToolUse", spool_arg), &[], &payload);
    assert!(out.status.success());
    assert!(out.stdout.is_empty(), "a hook that prints could be read as a permission decision");
    let text = std::fs::read_to_string(spool.join(format!("copilot-{SESSION}.jsonl"))).expect("feed file");
    let line: serde_json::Value = serde_json::from_str(text.trim()).expect("one json line");
    assert_eq!(line["agent"], "copilot");
    assert_eq!(line["session"], SESSION);
    assert_eq!(line["phase"], "reading");
    assert_eq!(line["detail"], "lib.rs");
    assert_eq!(line["at"], 1_795_062_601_000_u64);
    assert!(line["pid"].as_u64().is_some_and(|pid| pid > 0), "the hook reports who ran it");
}

#[test]
fn events_append_in_order_to_the_same_session_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let spool = dir.path().join("agents");
    let spool_arg = spool.to_str().expect("utf-8 path");
    for (event, extra) in [("userPromptSubmitted", r#","prompt":"private words""#), ("agentStop", r#","stopReason":"end_turn""#)] {
        let payload = format!(r#"{{"sessionId":"{SESSION}","timestamp":1795062601000,"cwd":"D:\\work"{extra}}}"#);
        assert!(run(&copilot_args(event, spool_arg), &[], &payload).status.success());
    }
    let text = std::fs::read_to_string(spool.join(format!("copilot-{SESSION}.jsonl"))).expect("feed file");
    let phases: Vec<String> = text
        .lines()
        .map(|l| serde_json::from_str::<serde_json::Value>(l).expect("json")["phase"].as_str().unwrap_or("").to_owned())
        .collect();
    assert_eq!(phases, ["thinking", "done"]);
    assert!(!text.contains("private words"), "prompt text is never written");
}

#[test]
fn unreadable_input_still_exits_zero_and_writes_nothing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let spool = dir.path().join("agents");
    let spool_arg = spool.to_str().expect("utf-8 path");
    for stdin in ["", "not json", r#"{"sessionId":"x"}"#] {
        assert!(run(&copilot_args("preToolUse", spool_arg), &[], stdin).status.success());
    }
    assert!(!spool.exists(), "no event, no folder");
    assert!(run(&["--agent", "copilot"], &[], "{}").status.success(), "no --spool is not an error either");
}

#[test]
fn without_arguments_it_is_still_the_claude_code_hook() {
    let dir = tempfile::tempdir().expect("tempdir");
    let config = dir.path().join(".claude");
    let payload = format!(r#"{{"session_id":"abc-123","hook_event_name":"UserPromptSubmit","cwd":"D:\\work\\dotDock"}}"#);
    let out = run(&[], &[("CLAUDE_CONFIG_DIR", &config)], &payload);
    assert!(out.status.success());
    let state = std::fs::read_to_string(config.join("tools").join("island").join("sessions").join("abc-123.json")).expect("state file");
    assert!(state.contains(r#""phase":"thinking""#) && state.contains(r#""agent":"claude""#), "{state}");
}

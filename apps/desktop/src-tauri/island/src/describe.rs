//! Maps a tool call to a phase and the one short thing worth showing (a file, a pattern, a command).
//!
//! Nothing here keeps prompt text, file contents or tool output. Commands are shown by their description
//! when the agent wrote one; otherwise the raw command is shown with obvious secrets masked.

use crate::hook::lenient_string;
use crate::phase::Phase;
use crate::util::{basename, clip};
use serde::Deserialize;

/// Longest detail line stored in a state file.
const DETAIL_LIMIT: usize = 80;
const MASK: &str = "…";

/// The fields of `tool_input` the island reads. Everything else in the payload is skipped unparsed.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct ToolInput {
    #[serde(deserialize_with = "lenient_string")]
    pub file_path: Option<String>,
    #[serde(deserialize_with = "lenient_string")]
    pub notebook_path: Option<String>,
    #[serde(deserialize_with = "lenient_string")]
    pub path: Option<String>,
    #[serde(deserialize_with = "lenient_string")]
    pub pattern: Option<String>,
    #[serde(deserialize_with = "lenient_string")]
    pub command: Option<String>,
    #[serde(deserialize_with = "lenient_string")]
    pub description: Option<String>,
    #[serde(deserialize_with = "lenient_string")]
    pub url: Option<String>,
    #[serde(deserialize_with = "lenient_string")]
    pub query: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Described {
    pub phase: Phase,
    pub tool: Option<String>,
    pub detail: Option<String>,
}

fn described(phase: Phase, tool: &str, detail: Option<String>) -> Described {
    let detail = detail.map(|d| clip(d.trim(), DETAIL_LIMIT)).filter(|d| !d.is_empty());
    Described { phase, tool: Some(tool.to_owned()), detail }
}

fn file_detail(input: &ToolInput) -> Option<String> {
    input
        .file_path
        .as_deref()
        .or(input.notebook_path.as_deref())
        .or(input.path.as_deref())
        .map(|p| basename(p).to_owned())
}

/// `https://example.com/docs/page?x=1` becomes `example.com/docs/page`.
fn url_detail(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    rest.split(['?', '#']).next().unwrap_or(rest).trim_end_matches('/').to_owned()
}

pub fn describe_claude(tool: &str, input: &ToolInput) -> Described {
    match tool {
        "Read" | "NotebookRead" | "LS" => described(Phase::Reading, tool, file_detail(input)),
        "Glob" | "Grep" => described(Phase::Searching, tool, input.pattern.clone().or_else(|| input.path.clone())),
        "WebSearch" => described(Phase::Searching, tool, input.query.clone()),
        "WebFetch" => described(Phase::Reading, tool, input.url.as_deref().map(url_detail)),
        "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => described(Phase::Editing, tool, file_detail(input)),
        "Bash" | "PowerShell" | "BashOutput" | "KillShell" => {
            let detail = input.description.clone().filter(|d| !d.trim().is_empty());
            described(Phase::Running, tool, detail.or_else(|| input.command.as_deref().map(redact_command)))
        }
        "Agent" | "Task" => described(Phase::Thinking, tool, input.description.clone()),
        "AskUserQuestion" | "ExitPlanMode" => described(Phase::Waiting, tool, None),
        other => described(Phase::Thinking, other, None),
    }
}

/// Words that mark the value next to them as a secret, compared in lower case.
const SECRET_WORDS: [&str; 8] = ["token", "secret", "password", "passwd", "apikey", "api_key", "api-key", "auth"];
/// Flags whose next argument is a secret.
const SECRET_FLAGS: [&str; 8] =
    ["--token", "--password", "--passwd", "--secret", "--api-key", "--apikey", "--auth", "bearer"];
/// Prefixes of well-known credential formats.
const SECRET_PREFIXES: [&str; 8] = ["sk-", "ghp_", "gho_", "github_pat_", "xoxb-", "xoxp-", "akia", "eyj"];

fn looks_secret(word: &str) -> bool {
    let lower = word.trim_matches(['"', '\'']).to_lowercase();
    lower.len() >= 16 && SECRET_PREFIXES.iter().any(|p| lower.starts_with(p))
}

/// Masks values that look like credentials in a shell command. Best effort; the detail is clipped as well.
pub fn redact_command(command: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut mask_next = false;
    for word in command.split_whitespace() {
        let lower = word.to_lowercase();
        if mask_next {
            mask_next = false;
            out.push(MASK.to_owned());
            continue;
        }
        if SECRET_FLAGS.contains(&lower.as_str()) {
            mask_next = true;
            out.push(word.to_owned());
            continue;
        }
        if let Some((key, _)) = word.split_once('=') {
            if SECRET_WORDS.iter().any(|w| key.to_lowercase().contains(w)) {
                out.push(format!("{key}={MASK}"));
                continue;
            }
        }
        out.push(if looks_secret(word) { MASK.to_owned() } else { word.to_owned() });
    }
    out.join(" ")
}

/// Pulls the JSON string that follows `"key":` out of free text. Escapes are decoded.
fn json_string_after(text: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let at = text.find(&needle)? + needle.len();
    let rest = text[at..].trim_start().strip_prefix(':')?.trim_start();
    serde_json::Deserializer::from_str(rest).into_iter::<String>().next()?.ok()
}

const SEARCH_COMMANDS: [&str; 12] =
    ["rg", "grep", "findstr", "select-string", "sls", "get-childitem", "gci", "ls", "dir", "find", "fd", "tree"];
const READ_COMMANDS: [&str; 12] =
    ["cat", "type", "get-content", "gc", "sed", "head", "tail", "nl", "more", "bat", "less", "wc"];
const EDIT_COMMANDS: [&str; 6] = ["apply_patch", "set-content", "add-content", "out-file", "new-item", "tee"];
const SHELL_WRAPPERS: [&str; 3] = ["powershell", "pwsh", "cmd"];

/// First word of a command with any `.exe` suffix and path removed, lower case.
fn command_name(word: &str) -> String {
    let name = basename(word.trim_matches(['"', '\'', '&'])).to_lowercase();
    name.strip_suffix(".exe").map(str::to_owned).unwrap_or(name)
}

/// Phase and detail for a shell command line, such as `rg --files` or `Get-Content -Raw index.html`.
fn describe_command(command: &str) -> (Phase, Option<String>) {
    let mut words = command.split_whitespace().skip_while(|w| *w == "&");
    let Some(first) = words.next() else { return (Phase::Running, None) };
    let name = command_name(first);
    if SHELL_WRAPPERS.contains(&name.as_str()) {
        let inner = command
            .split_once(" -Command ")
            .or_else(|| command.split_once(" -command "))
            .or_else(|| command.split_once(" -c "))
            .or_else(|| command.split_once(" /c "))
            .map(|(_, rest)| rest.trim().trim_matches(['"', '\'']));
        if let Some(inner) = inner.filter(|i| !i.is_empty()) {
            return describe_command(inner);
        }
    }
    if command.contains("apply_patch") || EDIT_COMMANDS.contains(&name.as_str()) {
        return (Phase::Editing, None);
    }
    if SEARCH_COMMANDS.contains(&name.as_str()) {
        return (Phase::Searching, Some(redact_command(command)));
    }
    if READ_COMMANDS.contains(&name.as_str()) {
        let file = command.split_whitespace().last().map(|w| basename(w.trim_matches(['"', '\''])).to_owned());
        return (Phase::Reading, file.filter(|f| !f.starts_with('-')));
    }
    (Phase::Running, Some(redact_command(command)))
}

/// First `*** Update File: path` (or Add/Delete) line of an apply_patch body, as a file name.
fn patch_file(text: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let line = line.trim().trim_start_matches('\\');
        ["*** Update File:", "*** Add File:", "*** Delete File:"]
            .iter()
            .find_map(|p| line.strip_prefix(p))
            .map(|path| basename(path.trim().trim_end_matches(['"', ',', ';'])).to_owned())
    })
}

/// Maps a Codex tool call. `name` is the call name (`exec`, `apply_patch`, `shell` ...), `input` its argument text.
pub fn describe_codex(name: &str, input: &str) -> Described {
    // Codex often wraps tools in a small script: the real call is `tools.<name>(...)` inside it.
    let unescaped = input.replace("\\n", "\n");
    if name == "apply_patch" || input.contains("*** Begin Patch") || unescaped.contains("*** Begin Patch") {
        return described(Phase::Editing, "apply_patch", patch_file(&unescaped));
    }
    if matches!(name, "exec" | "exec_command" | "shell" | "shell_command") {
        if let Some(cmd) = json_string_after(input, "cmd").or_else(|| json_string_after(input, "command")) {
            let (phase, detail) = describe_command(&cmd);
            return described(phase, "shell", detail);
        }
        if let Some(tool) = input
            .split("tools.")
            .nth(1)
            .map(|rest| rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect::<String>())
        {
            if tool.contains("web") || tool.contains("search") {
                return described(
                    Phase::Searching,
                    "web",
                    json_string_after(input, "q").or_else(|| json_string_after(input, "query")),
                );
            }
            if !tool.is_empty() && tool != "exec_command" {
                return described(Phase::Thinking, &tool.replace("mcp__", "").replace("__", " · "), None);
            }
        }
        return described(Phase::Running, "shell", None);
    }
    if name == "wait" {
        return described(Phase::Running, "shell", None);
    }
    described(Phase::Thinking, name, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(json: &str) -> ToolInput {
        serde_json::from_str(json).expect("tool input")
    }

    #[test]
    fn claude_file_tools_show_the_file_name() {
        let d = describe_claude("Read", &input(r#"{"file_path":"D:\\work\\dotDock\\src\\lib.rs"}"#));
        assert_eq!(d, Described { phase: Phase::Reading, tool: Some("Read".into()), detail: Some("lib.rs".into()) });
        let d = describe_claude(
            "Edit",
            &input(r#"{"file_path":"/home/me/app/main.ts","old_string":"a","new_string":"b"}"#),
        );
        assert_eq!((d.phase, d.detail.as_deref()), (Phase::Editing, Some("main.ts")));
        let d = describe_claude("Write", &input(r#"{"file_path":"C:\\x\\notes.md","content":"hello"}"#));
        assert_eq!((d.phase, d.detail.as_deref()), (Phase::Editing, Some("notes.md")));
    }

    #[test]
    fn claude_search_and_web_tools() {
        let d = describe_claude("Grep", &input(r#"{"pattern":"fn main","path":"src"}"#));
        assert_eq!((d.phase, d.detail.as_deref()), (Phase::Searching, Some("fn main")));
        let d = describe_claude("Glob", &input(r#"{"pattern":"**/*.tsx"}"#));
        assert_eq!(d.detail.as_deref(), Some("**/*.tsx"));
        let d = describe_claude(
            "WebFetch",
            &input(r#"{"url":"https://code.claude.com/docs/en/hooks?x=1#top","prompt":"p"}"#),
        );
        assert_eq!((d.phase, d.detail.as_deref()), (Phase::Reading, Some("code.claude.com/docs/en/hooks")));
        let d = describe_claude("WebSearch", &input(r#"{"query":"notify crate windows"}"#));
        assert_eq!((d.phase, d.detail.as_deref()), (Phase::Searching, Some("notify crate windows")));
    }

    #[test]
    fn bash_prefers_the_description_over_the_raw_command() {
        let d =
            describe_claude("Bash", &input(r#"{"command":"cargo test -p island","description":"Run island tests"}"#));
        assert_eq!((d.phase, d.detail.as_deref()), (Phase::Running, Some("Run island tests")));
        let d = describe_claude("Bash", &input(r#"{"command":"cargo test -p island"}"#));
        assert_eq!(d.detail.as_deref(), Some("cargo test -p island"));
        let d = describe_claude("PowerShell", &input(r#"{"command":"Get-Process"}"#));
        assert_eq!(d.phase, Phase::Running);
    }

    #[test]
    fn user_facing_tools_mean_waiting_and_unknown_tools_mean_thinking() {
        assert_eq!(describe_claude("AskUserQuestion", &ToolInput::default()).phase, Phase::Waiting);
        assert_eq!(describe_claude("ExitPlanMode", &ToolInput::default()).phase, Phase::Waiting);
        let d = describe_claude("mcp__github__create_issue", &ToolInput::default());
        assert_eq!((d.phase, d.tool.as_deref()), (Phase::Thinking, Some("mcp__github__create_issue")));
        let d = describe_claude("Agent", &input(r#"{"description":"Explore the repo","prompt":"long text"}"#));
        assert_eq!((d.phase, d.detail.as_deref()), (Phase::Thinking, Some("Explore the repo")));
    }

    #[test]
    fn long_details_are_clipped() {
        let long = format!(r#"{{"description":"{}"}}"#, "x".repeat(300));
        let d = describe_claude("Bash", &input(&long));
        assert!(d.detail.expect("detail").chars().count() <= DETAIL_LIMIT + 1);
    }

    #[test]
    fn secrets_in_commands_are_masked() {
        assert_eq!(
            redact_command("curl -H 'Authorization: Bearer abc123def' https://x"),
            "curl -H 'Authorization: Bearer … https://x"
        );
        assert_eq!(redact_command("deploy --token s3cr3t --env prod"), "deploy --token … --env prod");
        assert_eq!(redact_command("API_KEY=abc123 npm run build"), "API_KEY=… npm run build");
        assert_eq!(redact_command("echo sk-abcdefghijklmnopqrstuv"), "echo …");
        assert_eq!(redact_command("git status"), "git status");
        assert_eq!(redact_command("ls --auth"), "ls --auth");
    }

    #[test]
    fn codex_shell_commands_are_classified() {
        let call = |cmd: &str| {
            format!("const r = await tools.exec_command({{\"cmd\":{}}});", serde_json::to_string(cmd).expect("json"))
        };
        let d = describe_codex("exec", &call("Get-Content -Raw src\\index.html"));
        assert_eq!((d.phase, d.detail.as_deref()), (Phase::Reading, Some("index.html")));
        let d = describe_codex("exec", &call("rg --files -g *.tsx"));
        assert_eq!(d.phase, Phase::Searching);
        let d = describe_codex("exec", &call("Get-ChildItem -Force; rg --files"));
        assert_eq!(d.phase, Phase::Searching);
        let d = describe_codex("exec", &call("npm run build"));
        assert_eq!((d.phase, d.detail.as_deref()), (Phase::Running, Some("npm run build")));
        let d = describe_codex("exec", &call("powershell -NoProfile -Command \"Get-Content a.txt\""));
        assert_eq!(d.phase, Phase::Reading);
    }

    #[test]
    fn codex_patches_and_web_calls() {
        let patch = "const patch = \"*** Begin Patch\\n*** Update File: C:\\\\rabbit hole\\\\app\\\\main.ts\\n@@\\n\";";
        let d = describe_codex("exec", patch);
        assert_eq!((d.phase, d.detail.as_deref()), (Phase::Editing, Some("main.ts")));
        let d = describe_codex("apply_patch", "*** Begin Patch\n*** Add File: notes.md\n+x\n");
        assert_eq!((d.phase, d.detail.as_deref()), (Phase::Editing, Some("notes.md")));
        let d = describe_codex("exec", "await tools.web_search({\"q\":\"tauri window flags\"})");
        assert_eq!((d.phase, d.detail.as_deref()), (Phase::Searching, Some("tauri window flags")));
        assert_eq!(describe_codex("something_else", "").phase, Phase::Thinking);
    }
}

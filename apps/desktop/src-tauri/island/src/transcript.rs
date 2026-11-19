//! Reads Claude Code's own transcript (`~\.claude\projects\<project>\<session>.jsonl`) for what hooks cannot see:
//! interruptions, usage limits, API errors, token counts and session titles.
//!
//! The file is append-only JSON Lines and can grow to hundreds of megabytes, so everything here reads the tail
//! or only the bytes added since the last read. Lines that do not parse are skipped, never fatal: the format is
//! not a public contract.

use crate::hook::lenient_string;
use crate::problem::{classify, Problem};
use serde::Deserialize;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// How much of the end of the transcript is searched for the latest record.
pub const TAIL_BYTES: u64 = 64 * 1024;
/// Larger window for session titles, which are written once and then buried.
const TITLE_TAIL_BYTES: u64 = 512 * 1024;
const TITLE_HEAD_BYTES: u64 = 64 * 1024;
/// Without a recorded turn offset, token counting starts this far from the end.
const FALLBACK_WINDOW: u64 = 2 * 1024 * 1024;
/// Records written slightly before the hook stamped the turn still belong to it.
const GRACE_MS: u64 = 1_000;
const INTERRUPT_MARKER: &str = "[Request interrupted by user";
const SYNTHETIC_MODEL: &str = "<synthetic>";

/// `2026-11-19T05:02:29.042Z` to epoch milliseconds. Only the UTC form Claude Code writes is supported.
pub fn parse_iso_ms(text: &str) -> Option<u64> {
    let text = text.trim().strip_suffix('Z')?;
    let (date, time) = text.split_once('T')?;
    let mut d = date.split('-');
    let (year, month, day): (i64, u32, u32) =
        (d.next()?.parse().ok()?, d.next()?.parse().ok()?, d.next()?.parse().ok()?);
    let (clock, frac) = time.split_once('.').unwrap_or((time, "0"));
    let mut t = clock.split(':');
    let (hour, minute, second): (u64, u64, u64) =
        (t.next()?.parse().ok()?, t.next()?.parse().ok()?, t.next()?.parse().ok()?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let millis: u64 = format!("{:0<3}", frac).get(..3)?.parse().ok()?;
    // Days from civil date (proleptic Gregorian), see Howard Hinnant's date algorithms.
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = i64::from((month + 9) % 12);
    let doy = (153 * mp + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let secs = u64::try_from(days).ok()? * 86_400 + hour * 3_600 + minute * 60 + second;
    Some(secs * 1_000 + millis)
}

#[derive(Debug, Deserialize)]
struct Usage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
}

#[derive(Debug, Deserialize)]
struct Message {
    #[serde(default, deserialize_with = "lenient_string")]
    id: Option<String>,
    #[serde(default, deserialize_with = "lenient_string")]
    model: Option<String>,
    #[serde(default)]
    content: serde_json::Value,
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
struct Record {
    #[serde(rename = "type", default, deserialize_with = "lenient_string")]
    kind: Option<String>,
    #[serde(default, deserialize_with = "lenient_string")]
    timestamp: Option<String>,
    #[serde(rename = "isApiErrorMessage", default)]
    api_error: Option<bool>,
    #[serde(default, deserialize_with = "lenient_string")]
    error: Option<String>,
    #[serde(default)]
    message: Option<Message>,
}

impl Record {
    fn at_ms(&self) -> u64 {
        self.timestamp.as_deref().and_then(parse_iso_ms).unwrap_or(0)
    }

    /// Concatenated text blocks of the message (or the string content itself).
    fn text(&self) -> String {
        match self.message.as_ref().map(|m| &m.content) {
            Some(serde_json::Value::String(s)) => s.clone(),
            Some(serde_json::Value::Array(blocks)) => blocks
                .iter()
                .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join(" "),
            _ => String::new(),
        }
    }
}

/// The end of a file, starting at a line boundary.
pub struct Tail {
    pub text: String,
    pub size: u64,
}

pub fn read_tail(path: &Path, max_bytes: u64) -> std::io::Result<Tail> {
    let mut file = std::fs::File::open(path)?;
    let size = file.metadata()?.len();
    let start = size.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::with_capacity(usize::try_from(size - start).unwrap_or(0));
    file.read_to_end(&mut bytes)?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let text =
        if start > 0 { text.split_once('\n').map(|(_, rest)| rest.to_owned()).unwrap_or_default() } else { text };
    Ok(Tail { text, size })
}

/// What the newest user/assistant record says about the current turn.
#[derive(Clone, Debug, PartialEq)]
pub enum TailEvent {
    None,
    /// The user pressed Esc (or cancelled a tool).
    Interrupted {
        at_ms: u64,
    },
    /// The reply ended in an API error such as a usage limit or an expired login.
    Problem {
        problem: Problem,
        at_ms: u64,
    },
}

/// Looks at the newest user/assistant record in `text` and reports whether it ended the turn badly.
/// Records from before the turn started (`since_ms`) never count.
pub fn tail_event(text: &str, since_ms: u64) -> TailEvent {
    for line in text.lines().rev() {
        let line = line.trim();
        if !line.starts_with('{') || !(line.contains("\"user\"") || line.contains("\"assistant\"")) {
            continue;
        }
        let Ok(record) = serde_json::from_str::<Record>(line) else { continue };
        let kind = record.kind.as_deref();
        if kind != Some("user") && kind != Some("assistant") {
            continue;
        }
        let at_ms = record.at_ms();
        if at_ms + GRACE_MS < since_ms {
            return TailEvent::None;
        }
        return if kind == Some("assistant") {
            if record.api_error == Some(true) {
                TailEvent::Problem { problem: classify(record.error.as_deref().unwrap_or(""), &record.text()), at_ms }
            } else {
                TailEvent::None
            }
        } else if record.text().contains(INTERRUPT_MARKER) {
            TailEvent::Interrupted { at_ms }
        } else {
            TailEvent::None
        };
    }
    TailEvent::None
}

/// Output tokens produced this turn (de-duplicated per message) and the size of the context after the latest reply.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TurnTokens {
    pub output: u64,
    pub context: Option<u64>,
}

/// Counts tokens incrementally: each call reads only what was appended since the previous one.
/// A message is split over several transcript records that repeat the same usage, so counts are per message id.
#[derive(Default)]
pub struct TurnCounter {
    path: PathBuf,
    since_ms: u64,
    offset: u64,
    partial: Vec<u8>,
    per_message: HashMap<String, u64>,
    context: Option<u64>,
}

impl TurnCounter {
    pub fn tokens(&self) -> TurnTokens {
        TurnTokens { output: self.per_message.values().sum(), context: self.context }
    }

    /// `turn_start_ms` and `turn_offset` come from the state file; a zero offset falls back to the last 2 MiB.
    pub fn update(&mut self, path: &Path, turn_start_ms: u64, turn_offset: u64) -> TurnTokens {
        let Ok(mut file) = std::fs::File::open(path) else { return self.tokens() };
        let Ok(size) = file.metadata().map(|m| m.len()) else { return self.tokens() };
        if path != self.path || turn_start_ms != self.since_ms || size < self.offset {
            self.path = path.to_owned();
            self.since_ms = turn_start_ms;
            self.per_message.clear();
            self.partial.clear();
            self.context = None;
            self.offset =
                if turn_offset > 0 && turn_offset <= size { turn_offset } else { size.saturating_sub(FALLBACK_WINDOW) };
        }
        if size <= self.offset || file.seek(SeekFrom::Start(self.offset)).is_err() {
            return self.tokens();
        }
        let mut chunk = Vec::new();
        if file.take(size - self.offset).read_to_end(&mut chunk).is_err() {
            return self.tokens();
        }
        self.offset += chunk.len() as u64;
        let mut buffer = std::mem::take(&mut self.partial);
        buffer.extend_from_slice(&chunk);
        let complete_to = buffer.iter().rposition(|b| *b == b'\n').map_or(0, |i| i + 1);
        self.partial = buffer.split_off(complete_to);
        for line in String::from_utf8_lossy(&buffer).lines() {
            self.add_line(line);
        }
        self.tokens()
    }

    fn add_line(&mut self, line: &str) {
        if !line.contains("\"assistant\"") || !line.contains("\"usage\"") {
            return;
        }
        let Ok(record) = serde_json::from_str::<Record>(line) else { return };
        if record.kind.as_deref() != Some("assistant") || record.api_error == Some(true) {
            return;
        }
        if record.at_ms() + GRACE_MS < self.since_ms {
            return;
        }
        let Some(message) = record.message else { return };
        if message.model.as_deref() == Some(SYNTHETIC_MODEL) {
            return;
        }
        let (Some(id), Some(usage)) = (message.id, message.usage) else { return };
        let best = self.per_message.entry(id).or_insert(0);
        *best = (*best).max(usage.output_tokens);
        self.context = Some(usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens);
    }
}

#[derive(Debug, Deserialize)]
struct TitleRecord {
    #[serde(rename = "type", default, deserialize_with = "lenient_string")]
    kind: Option<String>,
    #[serde(rename = "customTitle", default, deserialize_with = "lenient_string")]
    custom: Option<String>,
    #[serde(rename = "aiTitle", default, deserialize_with = "lenient_string")]
    auto: Option<String>,
}

fn scan_titles(text: &str) -> (Option<String>, Option<String>) {
    let (mut custom, mut auto) = (None, None);
    for line in text.lines() {
        if !line.contains("-title\"") {
            continue;
        }
        let Ok(record) = serde_json::from_str::<TitleRecord>(line) else { continue };
        match record.kind.as_deref() {
            Some("custom-title") => custom = record.custom.filter(|t| !t.trim().is_empty()).or(custom),
            Some("ai-title") => auto = record.auto.filter(|t| !t.trim().is_empty()).or(auto),
            _ => {}
        }
    }
    (custom, auto)
}

/// The session's name: one given with `/rename` beats the one Claude Code generated.
pub fn session_title(path: &Path) -> Option<String> {
    let tail = read_tail(path, TITLE_TAIL_BYTES).ok()?;
    let (mut custom, mut auto) = scan_titles(&tail.text);
    if custom.is_none() && auto.is_none() && tail.size > TITLE_TAIL_BYTES {
        let mut head = vec![0u8; usize::try_from(TITLE_HEAD_BYTES).ok()?];
        let mut file = std::fs::File::open(path).ok()?;
        let read = file.read(&mut head).ok()?;
        (custom, auto) = scan_titles(&String::from_utf8_lossy(&head[..read]));
    }
    custom.or(auto)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::problem::ProblemKind;
    use std::io::Write;

    const T0: u64 = 1_795_063_911_000;

    fn iso(ms: u64) -> String {
        // Inverse of parse_iso_ms for the tests, built from the same civil-date math so a bug in one shows up.
        let secs = ms / 1000;
        let days = i64::try_from(secs / 86_400).expect("days") + 719_468;
        let era = days / 146_097;
        let doe = days - era * 146_097;
        let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let day = doy - (153 * mp + 2) / 5 + 1;
        let month = if mp < 10 { mp + 3 } else { mp - 9 };
        let year = yoe + era * 400 + i64::from(month <= 2);
        let rem = secs % 86_400;
        format!(
            "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
            rem / 3600,
            rem % 3600 / 60,
            rem % 60,
            ms % 1000
        )
    }

    fn user_prompt(at: u64) -> String {
        format!(r#"{{"type":"user","timestamp":"{}","message":{{"role":"user","content":"do the thing"}}}}"#, iso(at))
    }

    fn tool_result(at: u64) -> String {
        format!(
            r#"{{"type":"user","timestamp":"{}","message":{{"role":"user","content":[{{"type":"tool_result","content":"x"}}]}},"toolUseResult":{{}}}}"#,
            iso(at)
        )
    }

    fn interrupt(at: u64, suffix: &str) -> String {
        format!(
            r#"{{"type":"user","timestamp":"{}","message":{{"role":"user","content":[{{"type":"text","text":"[Request interrupted by user{suffix}]"}}]}}}}"#,
            iso(at)
        )
    }

    fn assistant(at: u64, id: &str, out: u64, input: u64, cache_read: u64) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{}","isSidechain":false,"message":{{"id":"{id}","model":"claude-x","role":"assistant","content":[{{"type":"text","text":"hi"}}],"usage":{{"input_tokens":{input},"cache_creation_input_tokens":5,"cache_read_input_tokens":{cache_read},"output_tokens":{out}}}}}}}"#,
            iso(at)
        )
    }

    fn api_error(at: u64, kind: &str, text: &str) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{}","isApiErrorMessage":true,"error":"{kind}","message":{{"id":"e","model":"<synthetic>","role":"assistant","content":[{{"type":"text","text":"{text}"}}],"usage":{{"input_tokens":0,"output_tokens":0}}}}}}"#,
            iso(at)
        )
    }

    fn noise(at: u64) -> String {
        format!(r#"{{"type":"attachment","timestamp":"{}","attachment":{{"type":"hook_success"}}}}"#, iso(at))
    }

    #[test]
    fn timestamps_parse_to_epoch_milliseconds() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso_ms("2000-03-01T00:00:00.000Z"), Some(951_868_800_000));
        assert_eq!(parse_iso_ms("2026-11-19T05:02:29.042Z"), Some(1_795_064_549_042));
        assert_eq!(parse_iso_ms("2026-11-19T05:02:29.5Z"), Some(1_795_064_549_500));
        assert_eq!(parse_iso_ms(&iso(T0)), Some(T0));
        for bad in ["", "yesterday", "2026-13-01T00:00:00Z", "2026-11-19 05:02:29", "2026-11-19T05:02:29+02:00"] {
            assert_eq!(parse_iso_ms(bad), None, "{bad}");
        }
    }

    #[test]
    fn interruption_is_detected_after_the_turn_started() {
        let text =
            [user_prompt(T0), assistant(T0 + 1_000, "m1", 10, 1, 1), noise(T0 + 2_000), interrupt(T0 + 3_000, "")]
                .join("\n");
        assert_eq!(tail_event(&text, T0), TailEvent::Interrupted { at_ms: T0 + 3_000 });
        let for_tool = [user_prompt(T0), interrupt(T0 + 3_000, " for tool use")].join("\n");
        assert_eq!(tail_event(&for_tool, T0), TailEvent::Interrupted { at_ms: T0 + 3_000 });
    }

    #[test]
    fn an_old_interruption_from_a_previous_turn_is_ignored() {
        let text = [interrupt(T0 - 60_000, ""), noise(T0 - 50_000)].join("\n");
        assert_eq!(tail_event(&text, T0), TailEvent::None);
    }

    #[test]
    fn a_reply_after_the_interruption_clears_it() {
        let text =
            [interrupt(T0 + 1_000, ""), user_prompt(T0 + 2_000), assistant(T0 + 3_000, "m2", 5, 1, 1)].join("\n");
        assert_eq!(tail_event(&text, T0), TailEvent::None);
    }

    #[test]
    fn tool_output_that_quotes_the_marker_is_not_an_interruption() {
        let quoted = format!(
            r#"{{"type":"user","timestamp":"{}","message":{{"role":"user","content":[{{"type":"tool_result","content":"[Request interrupted by user]"}}]}}}}"#,
            iso(T0 + 1_000)
        );
        assert_eq!(tail_event(&quoted, T0), TailEvent::None);
        assert_eq!(tail_event(&tool_result(T0 + 1_000), T0), TailEvent::None);
    }

    #[test]
    fn usage_limit_and_login_errors_are_classified() {
        let limit = api_error(T0 + 1_000, "rate_limit", "You've hit your session limit · resets 1:50pm (Asia/Taipei)");
        let TailEvent::Problem { problem, at_ms } = tail_event(&[user_prompt(T0), limit].join("\n"), T0) else {
            panic!("expected a problem")
        };
        assert_eq!(
            (problem.kind, problem.message.as_str(), problem.resets.as_deref()),
            (ProblemKind::UsageLimit, "Session limit", Some("1:50pm"))
        );
        assert_eq!(at_ms, T0 + 1_000);
        let login = api_error(T0 + 1_000, "authentication_failed", "Please run /login · API Error: 401");
        let TailEvent::Problem { problem, .. } = tail_event(&login, T0) else { panic!("expected a problem") };
        assert_eq!(problem.kind, ProblemKind::Login);
    }

    #[test]
    fn partial_last_line_and_junk_are_skipped() {
        let text = format!("{}\n{{\"type\":\"assis", interrupt(T0 + 1_000, ""));
        assert_eq!(tail_event(&text, T0), TailEvent::Interrupted { at_ms: T0 + 1_000 });
        assert_eq!(tail_event("garbage\n\n{}\n", T0), TailEvent::None);
    }

    fn write_lines(path: &Path, lines: &[String]) {
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path).expect("open");
        for line in lines {
            writeln!(file, "{line}").expect("write");
        }
    }

    #[test]
    fn tokens_are_deduplicated_per_message_and_grow_incrementally() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("s.jsonl");
        write_lines(&path, &[user_prompt(T0 - 5_000), assistant(T0 - 4_000, "before", 999, 1, 1)]);
        let offset = std::fs::metadata(&path).expect("meta").len();
        write_lines(
            &path,
            &[user_prompt(T0), assistant(T0 + 1_000, "m1", 120, 4, 1_000), assistant(T0 + 1_100, "m1", 126, 4, 1_000)],
        );
        let mut counter = TurnCounter::default();
        let first = counter.update(&path, T0, offset);
        assert_eq!(first, TurnTokens { output: 126, context: Some(4 + 5 + 1_000) });
        write_lines(&path, &[tool_result(T0 + 2_000), assistant(T0 + 3_000, "m2", 40, 2, 2_000)]);
        let second = counter.update(&path, T0, offset);
        assert_eq!(second.output, 166);
        assert_eq!(second.context, Some(2 + 5 + 2_000));
        assert_eq!(counter.update(&path, T0, offset), second, "no new bytes, same answer");
    }

    #[test]
    fn a_new_turn_resets_the_count_and_errors_are_never_counted() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("s.jsonl");
        write_lines(&path, &[assistant(T0 + 1_000, "m1", 50, 1, 1)]);
        let mut counter = TurnCounter::default();
        assert_eq!(counter.update(&path, T0, 0).output, 50);
        let offset = std::fs::metadata(&path).expect("meta").len();
        write_lines(&path, &[api_error(T0 + 20_000, "rate_limit", "x"), assistant(T0 + 21_000, "m9", 7, 1, 1)]);
        assert_eq!(counter.update(&path, T0 + 20_000, offset).output, 7);
    }

    #[test]
    fn a_half_written_line_is_completed_on_the_next_read() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("s.jsonl");
        let line = assistant(T0 + 1_000, "m1", 33, 1, 1);
        let (head, rest) = line.split_at(line.len() / 2);
        std::fs::write(&path, head).expect("write head");
        let mut counter = TurnCounter::default();
        assert_eq!(counter.update(&path, T0, 0).output, 0);
        let mut file = std::fs::OpenOptions::new().append(true).open(&path).expect("open");
        writeln!(file, "{rest}").expect("write rest");
        assert_eq!(counter.update(&path, T0, 0).output, 33);
    }

    #[test]
    fn a_truncated_or_missing_file_resets_quietly() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("s.jsonl");
        let mut counter = TurnCounter::default();
        assert_eq!(counter.update(&path, T0, 0), TurnTokens::default());
        write_lines(&path, &[assistant(T0 + 1_000, "m1", 80, 1, 1)]);
        assert_eq!(counter.update(&path, T0, 0).output, 80);
        std::fs::write(&path, b"").expect("truncate");
        assert_eq!(counter.update(&path, T0, 0).output, 0);
    }

    #[test]
    fn read_tail_starts_on_a_line_boundary() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("s.jsonl");
        std::fs::write(&path, "aaaaaaaa\nbbbb\ncccc\n").expect("write");
        let tail = read_tail(&path, 10).expect("tail");
        assert_eq!(tail.text, "cccc\n");
        assert_eq!(tail.size, 19);
        assert_eq!(read_tail(&path, 1_000).expect("whole").text, "aaaaaaaa\nbbbb\ncccc\n");
    }

    #[test]
    fn custom_title_beats_the_generated_one() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("s.jsonl");
        write_lines(
            &path,
            &[
                r#"{"type":"ai-title","aiTitle":"Generated name","sessionId":"s"}"#.to_owned(),
                user_prompt(T0),
                r#"{"type":"custom-title","customTitle":"My name","sessionId":"s"}"#.to_owned(),
            ],
        );
        assert_eq!(session_title(&path).as_deref(), Some("My name"));
        let only_ai = dir.path().join("t.jsonl");
        write_lines(&only_ai, &[r#"{"type":"ai-title","aiTitle":"Generated name","sessionId":"s"}"#.to_owned()]);
        assert_eq!(session_title(&only_ai).as_deref(), Some("Generated name"));
        assert_eq!(session_title(&dir.path().join("missing.jsonl")), None);
    }
}

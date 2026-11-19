//! Turns Claude Code's API error text into something the island can show.
//!
//! The error kinds are the `error` values of transcript error records and of the `StopFailure` hook
//! (`rate_limit`, `authentication_failed`, `model_not_found`, ...). Usage limits and server throttling
//! share `rate_limit`, so the text decides.

use crate::util::clip;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProblemKind {
    UsageLimit,
    Login,
    Connection,
    Overloaded,
    Model,
    Api,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub kind: ProblemKind,
    /// Short raw text from the agent, already trimmed.
    pub message: String,
    /// Reset time as the agent printed it, when it gave one.
    pub resets: Option<String>,
}

/// Longest raw message kept for kinds that have no better label.
const MESSAGE_LIMIT: usize = 80;
/// Phrases in connection failures, in lower case.
const CONNECTION_HINTS: [&str; 6] = ["enotfound", "econnreset", "socket", "went to sleep", "timed out", "connect"];

/// "You've hit your session limit · resets 1:50pm (Asia/Taipei)" gives ("Session limit", Some("1:50pm")).
fn parse_limit(text: &str) -> (String, Option<String>) {
    let lower = text.to_lowercase();
    let kind = lower
        .find("hit your ")
        .map(|start| start + "hit your ".len())
        .and_then(|from| lower[from..].find(" limit").map(|len| &text[from..from + len]))
        .map(|word| {
            let mut chars = word.trim().chars();
            let head: String = chars.next().map(|c| c.to_uppercase().collect()).unwrap_or_default();
            format!("{head}{} limit", chars.as_str())
        })
        .unwrap_or_else(|| "Usage limit".to_owned());
    let resets = lower.find("resets ").map(|at| {
        let tail = &text[at + "resets ".len()..];
        let end = tail.find(" (").or_else(|| tail.find(['\n', '\r'])).unwrap_or(tail.len());
        tail[..end].trim().to_owned()
    });
    (kind, resets.filter(|r| !r.is_empty()))
}

/// `kind` is the agent's error code (may be empty), `text` the rendered error message.
pub fn classify(kind: &str, text: &str) -> Problem {
    let lower = text.to_lowercase();
    if (kind == "rate_limit" || kind.is_empty()) && lower.contains("hit your") {
        let (message, resets) = parse_limit(text);
        return Problem { kind: ProblemKind::UsageLimit, message, resets };
    }
    let (problem, message) =
        if matches!(kind, "authentication_failed" | "oauth_org_not_allowed") || lower.contains("/login") {
            (ProblemKind::Login, "Signed out")
        } else if CONNECTION_HINTS.iter().any(|hint| lower.contains(hint)) {
            (ProblemKind::Connection, "Connection lost")
        } else if kind == "model_not_found" {
            (ProblemKind::Model, "Model unavailable")
        } else if kind == "server_error"
            || kind == "rate_limit"
            || lower.contains("overloaded")
            || lower.contains("temporarily limiting")
        {
            (ProblemKind::Overloaded, "Server busy")
        } else {
            let cleaned = text.trim().trim_start_matches("API Error:").trim();
            return Problem { kind: ProblemKind::Api, message: clip(cleaned, MESSAGE_LIMIT), resets: None };
        };
    Problem { kind: problem, message: message.to_owned(), resets: None }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_limit_keeps_kind_and_reset_time() {
        let p = classify("rate_limit", "You've hit your session limit · resets 1:50pm (Asia/Taipei)");
        assert_eq!(p.kind, ProblemKind::UsageLimit);
        assert_eq!(p.message, "Session limit");
        assert_eq!(p.resets.as_deref(), Some("1:50pm"));
    }

    #[test]
    fn weekly_limit_without_reset_time() {
        let p = classify("rate_limit", "You've hit your weekly limit");
        assert_eq!(p.message, "Weekly limit");
        assert_eq!(p.resets, None);
    }

    #[test]
    fn plain_rate_limit_is_a_busy_server_not_a_usage_limit() {
        let p = classify("rate_limit", "API Error: Rate limit reached");
        assert_eq!(p.kind, ProblemKind::Overloaded);
    }

    #[test]
    fn login_failures_from_real_transcripts() {
        let p =
            classify("authentication_failed", "Please run /login · API Error: 401 Fail : Network policy is required.");
        assert_eq!(p.kind, ProblemKind::Login);
        let p =
            classify("authentication_failed", "Please run /login · API Error: 403 Not authorized for this endpoint");
        assert_eq!(p.kind, ProblemKind::Login);
        let p = classify("", "run /login to sign in again");
        assert_eq!(p.kind, ProblemKind::Login);
    }

    #[test]
    fn connection_and_model_and_fallback() {
        assert_eq!(classify("unknown", "request failed: ECONNRESET").kind, ProblemKind::Connection);
        assert_eq!(classify("model_not_found", "no such model").kind, ProblemKind::Model);
        let p = classify("invalid_request", "API Error: 400 messages: text content blocks must be non-empty");
        assert_eq!(p.kind, ProblemKind::Api);
        assert_eq!(p.message, "400 messages: text content blocks must be non-empty");
    }

    #[test]
    fn long_fallback_messages_are_clipped() {
        let p = classify("unknown", &"x".repeat(300));
        assert!(p.message.chars().count() <= MESSAGE_LIMIT + 1);
    }
}

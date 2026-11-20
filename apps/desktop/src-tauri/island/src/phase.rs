//! What an agent session is doing, and which agent it is.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    /// Nothing running. Never shown.
    #[default]
    Idle,
    Thinking,
    Reading,
    Searching,
    Editing,
    Running,
    /// Blocked on the user (permission prompt, question, plan approval).
    Waiting,
    Done,
    Paused,
    /// Usage limit reached.
    Limit,
    /// Login, connection or other API error.
    Error,
    Stopped,
}

impl Phase {
    /// The turn is over; the island lingers for a few seconds and then collapses.
    pub fn is_terminal(self) -> bool {
        matches!(self, Phase::Done | Phase::Paused | Phase::Limit | Phase::Error | Phase::Stopped)
    }

    /// The agent is busy or blocked, so the island stays up until something changes.
    pub fn is_active(self) -> bool {
        !self.is_terminal() && self != Phase::Idle
    }

    /// The agent is producing work (everything active except waiting on the user).
    pub fn is_working(self) -> bool {
        self.is_active() && self != Phase::Waiting
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentKind {
    #[default]
    Claude,
    Codex,
    Copilot,
    #[serde(rename = "opencode")]
    OpenCode,
    /// Any other agent that writes to the feed (`docs/ISLAND_PROTOCOL.md`); its own name travels with the session.
    Other,
}

impl AgentKind {
    /// The agent's product name, as shown in toasts.
    pub fn label(self) -> &'static str {
        match self {
            AgentKind::Claude => "Claude Code",
            AgentKind::Codex => "Codex",
            AgentKind::Copilot => "GitHub Copilot CLI",
            AgentKind::OpenCode => "OpenCode",
            AgentKind::Other => "Agent",
        }
    }

    /// The kind a feed agent id stands for. Claude Code and Codex have their own sources, so a feed never claims them.
    pub fn from_feed_id(id: &str) -> Self {
        match id {
            "copilot" => AgentKind::Copilot,
            "opencode" => AgentKind::OpenCode,
            _ => AgentKind::Other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase_classes_do_not_overlap() {
        for phase in [Phase::Thinking, Phase::Reading, Phase::Searching, Phase::Editing, Phase::Running] {
            assert!(phase.is_active() && phase.is_working() && !phase.is_terminal());
        }
        assert!(Phase::Waiting.is_active() && !Phase::Waiting.is_working());
        for phase in [Phase::Done, Phase::Paused, Phase::Limit, Phase::Error, Phase::Stopped] {
            assert!(phase.is_terminal() && !phase.is_active() && !phase.is_working());
        }
        assert!(!Phase::Idle.is_active() && !Phase::Idle.is_terminal());
    }

    #[test]
    fn wire_names_match_the_typescript_protocol() {
        assert_eq!(serde_json::to_string(&Phase::Limit).expect("json"), "\"limit\"");
        assert_eq!(serde_json::to_string(&Phase::Running).expect("json"), "\"running\"");
        assert_eq!(serde_json::to_string(&AgentKind::Codex).expect("json"), "\"codex\"");
        assert_eq!(serde_json::to_string(&AgentKind::Copilot).expect("json"), "\"copilot\"");
        assert_eq!(serde_json::to_string(&AgentKind::OpenCode).expect("json"), "\"opencode\"");
        assert_eq!(serde_json::to_string(&AgentKind::Other).expect("json"), "\"other\"");
    }

    #[test]
    fn feed_ids_map_to_kinds_and_never_to_the_built_in_sources() {
        assert_eq!(AgentKind::from_feed_id("copilot"), AgentKind::Copilot);
        assert_eq!(AgentKind::from_feed_id("opencode"), AgentKind::OpenCode);
        assert_eq!(AgentKind::from_feed_id("aider"), AgentKind::Other);
        assert_eq!(AgentKind::from_feed_id("claude"), AgentKind::Other);
        assert_eq!(AgentKind::from_feed_id("codex"), AgentKind::Other);
        assert_eq!(AgentKind::Copilot.label(), "GitHub Copilot CLI");
    }
}

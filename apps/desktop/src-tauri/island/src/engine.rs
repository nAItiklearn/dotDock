//! Merges every source (hook state files, transcript probes, Codex logs, process liveness) into the snapshot
//! the island shows. Pure and clock-free: callers pass `now_ms`, so the whole lifecycle is unit-tested without
//! sleeping.

use crate::phase::{AgentKind, Phase};
use crate::problem::{Problem, ProblemKind};
use crate::state::SessionState;
use crate::transcript::{TailEvent, TurnTokens};
use serde::Serialize;
use std::collections::HashMap;

/// A phase change is announced (chime, toast) only while it is this fresh, so restarting the app never
/// replays old finishes.
const ALERT_FRESH_MS: u64 = 30_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngineConfig {
    pub linger_done_ms: u64,
    pub linger_paused_ms: u64,
    pub linger_stopped_ms: u64,
    pub linger_problem_ms: u64,
    /// An active session with no known process and no update for this long is treated as gone.
    pub stale_ms: u64,
    /// Sessions untouched this long are dropped from memory.
    pub forget_ms: u64,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            linger_done_ms: 6_000,
            linger_paused_ms: 2_500,
            linger_stopped_ms: 2_500,
            linger_problem_ms: 15_000,
            stale_ms: 5 * 60_000,
            forget_ms: 6 * 3_600_000,
        }
    }
}

impl EngineConfig {
    fn linger(&self, phase: Phase) -> u64 {
        match phase {
            Phase::Done => self.linger_done_ms,
            Phase::Paused => self.linger_paused_ms,
            Phase::Stopped => self.linger_stopped_ms,
            Phase::Limit | Phase::Error => self.linger_problem_ms,
            _ => 0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub id: String,
    pub agent: AgentKind,
    pub phase: Phase,
    pub tool: Option<String>,
    pub detail: Option<String>,
    pub project: String,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub problem: Option<Problem>,
    pub tokens_out: u64,
    pub context_tokens: Option<u64>,
    pub turn_started_at: Option<u64>,
    pub updated_at: u64,
    pub collapse_at: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub seq: u64,
    pub sessions: Vec<SessionView>,
    pub current: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertKind {
    Done,
    Waiting,
    Limit,
    Error,
}

/// A moment worth interrupting the user for: sound, toast.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    pub session_id: String,
    pub agent: AgentKind,
    pub kind: AlertKind,
    pub project: String,
    /// What was finished, or what the agent is asking for.
    pub text: Option<String>,
    pub problem: Option<Problem>,
}

struct Tracked {
    state: SessionState,
    tail: TailEvent,
    tokens: TurnTokens,
    alive: Option<bool>,
    dead_at: Option<u64>,
    dismissed_seq: Option<u64>,
    announced: Option<(Phase, u64)>,
    last_phase: Phase,
}

struct Effective {
    phase: Phase,
    problem: Option<Problem>,
    at: u64,
}

pub struct Engine {
    cfg: EngineConfig,
    sessions: HashMap<String, Tracked>,
    current: Option<String>,
    published: Option<Snapshot>,
    seq: u64,
}

fn alert_kind(phase: Phase) -> Option<AlertKind> {
    match phase {
        Phase::Done => Some(AlertKind::Done),
        Phase::Waiting => Some(AlertKind::Waiting),
        Phase::Limit => Some(AlertKind::Limit),
        Phase::Error => Some(AlertKind::Error),
        _ => None,
    }
}

impl Engine {
    pub fn new(cfg: EngineConfig) -> Self {
        Self { cfg, sessions: HashMap::new(), current: None, published: None, seq: 0 }
    }

    pub fn set_config(&mut self, cfg: EngineConfig) {
        self.cfg = cfg;
    }

    /// Takes a state from a hook file or a Codex log. Older states than the one held are ignored.
    pub fn apply_state(&mut self, state: SessionState) {
        let id = state.session_id.clone();
        match self.sessions.get_mut(&id) {
            Some(t) if state.seq < t.state.seq => {}
            Some(t) => {
                if state.turn_started_at != t.state.turn_started_at {
                    t.tail = TailEvent::None;
                    t.tokens = TurnTokens::default();
                }
                if state.pid != t.state.pid || state.pid_start != t.state.pid_start {
                    t.alive = None;
                    t.dead_at = None;
                }
                t.state = state;
            }
            None => {
                let last_phase = state.phase;
                self.sessions.insert(
                    id,
                    Tracked {
                        state,
                        tail: TailEvent::None,
                        tokens: TurnTokens::default(),
                        alive: None,
                        dead_at: None,
                        dismissed_seq: None,
                        announced: None,
                        last_phase,
                    },
                );
            }
        }
    }

    pub fn remove(&mut self, id: &str) {
        self.sessions.remove(id);
        if self.current.as_deref() == Some(id) {
            self.current = None;
        }
    }

    pub fn set_transcript_view(&mut self, id: &str, tail: TailEvent, tokens: TurnTokens) {
        if let Some(t) = self.sessions.get_mut(id) {
            t.tail = tail;
            t.tokens = tokens;
        }
    }

    pub fn set_alive(&mut self, id: &str, alive: bool, now_ms: u64) {
        if let Some(t) = self.sessions.get_mut(id) {
            t.alive = Some(alive);
            if !alive && t.dead_at.is_none() {
                t.dead_at = Some(now_ms);
            }
        }
    }

    /// Hides a session until its next state change (the user dismissed it).
    pub fn dismiss(&mut self, id: &str) {
        if let Some(t) = self.sessions.get_mut(id) {
            t.dismissed_seq = Some(t.state.seq);
        }
    }

    /// Some session is working or waiting right now.
    pub fn has_active(&self) -> bool {
        self.sessions.values().any(|t| t.state.phase.is_active())
    }

    pub fn session_ids(&self) -> Vec<String> {
        self.sessions.keys().cloned().collect()
    }

    pub fn state_of(&self, id: &str) -> Option<&SessionState> {
        self.sessions.get(id).map(|t| &t.state)
    }

    /// Sessions whose transcript should be probed: active ones with a transcript path.
    pub fn transcript_targets(&self) -> Vec<(&str, &SessionState)> {
        self.sessions
            .iter()
            .filter(|(_, t)| t.state.phase.is_active() && t.state.transcript.is_some())
            .map(|(id, t)| (id.as_str(), &t.state))
            .collect()
    }

    /// Active sessions with a known process, for the periodic liveness check.
    pub fn liveness_targets(&self) -> Vec<(String, u32, Option<u64>)> {
        self.sessions
            .iter()
            .filter(|(_, t)| t.state.phase.is_active() && t.alive != Some(false))
            .filter_map(|(id, t)| t.state.pid.map(|pid| (id.clone(), pid, t.state.pid_start)))
            .collect()
    }

    fn effective(&self, t: &Tracked, now_ms: u64) -> Effective {
        let s = &t.state;
        let mut out = Effective { phase: s.phase, problem: s.problem.clone(), at: s.updated_at };
        if !s.phase.is_active() {
            return out;
        }
        match &t.tail {
            TailEvent::Interrupted { at_ms } => {
                out = Effective { phase: Phase::Paused, problem: None, at: *at_ms };
            }
            TailEvent::Problem { problem, at_ms } => {
                let phase = if problem.kind == ProblemKind::UsageLimit { Phase::Limit } else { Phase::Error };
                out = Effective { phase, problem: Some(problem.clone()), at: *at_ms };
            }
            TailEvent::None => {}
        }
        if out.phase.is_active() {
            if t.alive == Some(false) {
                out = Effective { phase: Phase::Stopped, problem: None, at: t.dead_at.unwrap_or(now_ms) };
            } else if s.pid.is_none() && now_ms > s.updated_at + self.cfg.stale_ms {
                out.phase = Phase::Idle;
            }
        }
        out
    }

    fn collapse_at(&self, e: &Effective) -> Option<u64> {
        e.phase.is_terminal().then(|| e.at + self.cfg.linger(e.phase))
    }

    fn visible(&self, t: &Tracked, e: &Effective, now_ms: u64) -> bool {
        if t.dismissed_seq == Some(t.state.seq) || e.phase == Phase::Idle {
            return false;
        }
        self.collapse_at(e).is_none_or(|until| now_ms < until)
    }

    /// Recomputes what is visible. Also reports the alerts that became due since the last call.
    pub fn snapshot(&mut self, now_ms: u64) -> (Snapshot, Vec<Alert>) {
        let mut views: Vec<SessionView> = Vec::new();
        let mut alerts = Vec::new();
        let mut entered: Vec<String> = Vec::new();
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        for id in ids {
            let Some(t) = self.sessions.get(&id) else { continue };
            let e = self.effective(t, now_ms);
            let visible = self.visible(t, &e, now_ms);
            let announce = alert_kind(e.phase)
                .filter(|_| now_ms.saturating_sub(e.at) <= ALERT_FRESH_MS && t.announced != Some((e.phase, e.at)));
            if visible {
                let s = &t.state;
                let is_claude = s.transcript.is_some();
                views.push(SessionView {
                    id: id.clone(),
                    agent: s.agent,
                    phase: e.phase,
                    tool: s.tool.clone(),
                    detail: s.detail.clone(),
                    project: s.project.clone(),
                    title: s.title.clone(),
                    summary: (e.phase == Phase::Done).then(|| s.summary.clone()).flatten(),
                    problem: e.problem.clone(),
                    tokens_out: if is_claude { t.tokens.output } else { s.tokens_out.unwrap_or(0) },
                    context_tokens: if is_claude { t.tokens.context } else { s.context },
                    turn_started_at: s.turn_started_at,
                    updated_at: e.at,
                    collapse_at: self.collapse_at(&e),
                });
                if e.phase != t.last_phase && alert_kind(e.phase).is_some() {
                    entered.push(id.clone());
                }
            }
            if let Some(kind) = announce {
                alerts.push(Alert {
                    session_id: id.clone(),
                    agent: t.state.agent,
                    kind,
                    project: t.state.project.clone(),
                    text: match kind {
                        AlertKind::Done => t.state.summary.clone(),
                        AlertKind::Waiting => t.state.detail.clone(),
                        AlertKind::Limit | AlertKind::Error => None,
                    },
                    problem: e.problem.clone(),
                });
            }
            if let Some(t) = self.sessions.get_mut(&id) {
                if announce.is_some() {
                    t.announced = Some((e.phase, e.at));
                }
                t.last_phase = e.phase;
            }
        }
        views.sort_by(|a, b| (a.turn_started_at, &a.id).cmp(&(b.turn_started_at, &b.id)));

        let still_visible = |id: &Option<String>| id.as_ref().is_some_and(|id| views.iter().any(|v| &v.id == id));
        if let Some(popped) = entered.into_iter().find(|id| self.current.as_ref() != Some(id)) {
            self.current = Some(popped);
        } else if !still_visible(&self.current) {
            self.current = views.iter().max_by_key(|v| v.updated_at).map(|v| v.id.clone());
        }

        let next = Snapshot { seq: self.seq, sessions: views, current: self.current.clone() };
        let changed = self.published.as_ref().is_none_or(|p| p.sessions != next.sessions || p.current != next.current);
        if changed {
            self.seq += 1;
            let published = Snapshot { seq: self.seq, ..next };
            self.published = Some(published);
        }
        let snapshot =
            self.published.clone().unwrap_or(Snapshot { seq: self.seq, sessions: Vec::new(), current: None });
        (snapshot, alerts)
    }

    /// Earliest moment `snapshot` could change without any new input: a terminal phase collapsing or an
    /// unattended session going stale.
    pub fn next_deadline(&self, now_ms: u64) -> Option<u64> {
        self.sessions
            .values()
            .filter_map(|t| {
                let e = self.effective(t, now_ms);
                if t.dismissed_seq == Some(t.state.seq) {
                    return None;
                }
                self.collapse_at(&e).or_else(|| {
                    (e.phase.is_active() && t.state.pid.is_none()).then(|| t.state.updated_at + self.cfg.stale_ms + 1)
                })
            })
            .filter(|at| *at > now_ms)
            .min()
    }

    /// Forgets sessions that have been quiet for a long time.
    pub fn forget_old(&mut self, now_ms: u64) -> Vec<String> {
        let limit = self.cfg.forget_ms;
        let gone: Vec<String> = self
            .sessions
            .iter()
            .filter(|(_, t)| now_ms > t.state.updated_at + limit)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &gone {
            self.remove(id);
        }
        gone
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: u64 = 1_000_000;

    fn state(id: &str, phase: Phase, updated: u64) -> SessionState {
        let mut s = SessionState::new(AgentKind::Claude, id);
        s.phase = phase;
        s.updated_at = updated;
        s.seq = updated * 1_000_000;
        s.turn_started_at = Some(T);
        s.project = "dotDock".into();
        s.transcript = Some(format!("C:\\t\\{id}.jsonl"));
        s.pid = Some(100);
        s
    }

    fn visible_ids(engine: &mut Engine, now: u64) -> Vec<String> {
        engine.snapshot(now).0.sessions.into_iter().map(|v| v.id).collect()
    }

    #[test]
    fn working_sessions_stay_visible_for_as_long_as_the_process_lives() {
        let mut engine = Engine::new(EngineConfig::default());
        engine.apply_state(state("a", Phase::Running, T));
        assert_eq!(visible_ids(&mut engine, T + 3_600_000), vec!["a"]);
        assert_eq!(engine.next_deadline(T), None, "a live process has no timeout");
    }

    #[test]
    fn a_dead_process_stops_the_session_and_then_collapses() {
        let mut engine = Engine::new(EngineConfig::default());
        engine.apply_state(state("a", Phase::Thinking, T));
        engine.set_alive("a", false, T + 10_000);
        let (snap, _) = engine.snapshot(T + 10_100);
        assert_eq!(snap.sessions[0].phase, Phase::Stopped);
        assert!(visible_ids(&mut engine, T + 10_000 + 2_499).len() == 1);
        assert!(visible_ids(&mut engine, T + 10_000 + 2_500).is_empty());
    }

    #[test]
    fn unattended_sessions_without_a_process_go_stale() {
        let mut engine = Engine::new(EngineConfig::default());
        let mut s = state("c", Phase::Thinking, T);
        s.pid = None;
        s.agent = AgentKind::Codex;
        engine.apply_state(s);
        let stale_at = T + EngineConfig::default().stale_ms + 1;
        assert_eq!(engine.next_deadline(T), Some(stale_at));
        assert_eq!(visible_ids(&mut engine, stale_at - 1).len(), 1);
        assert!(visible_ids(&mut engine, stale_at).is_empty());
    }

    #[test]
    fn done_lingers_then_collapses_and_reports_the_deadline() {
        let mut engine = Engine::new(EngineConfig::default());
        let mut s = state("a", Phase::Done, T);
        s.summary = Some("All tests pass".into());
        engine.apply_state(s);
        let (snap, _) = engine.snapshot(T + 100);
        assert_eq!(snap.sessions[0].summary.as_deref(), Some("All tests pass"));
        assert_eq!(snap.sessions[0].collapse_at, Some(T + 6_000));
        assert_eq!(engine.next_deadline(T + 100), Some(T + 6_000));
        assert!(visible_ids(&mut engine, T + 6_000).is_empty());
        assert_eq!(engine.next_deadline(T + 6_000), None);
    }

    #[test]
    fn transcript_interruption_overrides_a_hook_that_never_came() {
        let mut engine = Engine::new(EngineConfig::default());
        engine.apply_state(state("a", Phase::Thinking, T));
        engine.set_transcript_view("a", TailEvent::Interrupted { at_ms: T + 4_000 }, TurnTokens::default());
        let (snap, _) = engine.snapshot(T + 4_100);
        assert_eq!(snap.sessions[0].phase, Phase::Paused);
        assert!(visible_ids(&mut engine, T + 4_000 + 2_500).is_empty());
    }

    #[test]
    fn transcript_errors_become_limit_or_error() {
        let mut engine = Engine::new(EngineConfig::default());
        engine.apply_state(state("a", Phase::Thinking, T));
        let limit =
            Problem { kind: ProblemKind::UsageLimit, message: "Session limit".into(), resets: Some("1:50pm".into()) };
        engine.set_transcript_view("a", TailEvent::Problem { problem: limit, at_ms: T + 2_000 }, TurnTokens::default());
        let (snap, alerts) = engine.snapshot(T + 2_100);
        assert_eq!(snap.sessions[0].phase, Phase::Limit);
        assert_eq!(snap.sessions[0].problem.as_ref().map(|p| p.kind), Some(ProblemKind::UsageLimit));
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].kind, AlertKind::Limit);
        let login = Problem { kind: ProblemKind::Login, message: "Signed out".into(), resets: None };
        engine.set_transcript_view("a", TailEvent::Problem { problem: login, at_ms: T + 3_000 }, TurnTokens::default());
        assert_eq!(engine.snapshot(T + 3_100).0.sessions[0].phase, Phase::Error);
    }

    #[test]
    fn a_new_turn_discards_the_previous_transcript_verdict() {
        let mut engine = Engine::new(EngineConfig::default());
        engine.apply_state(state("a", Phase::Thinking, T));
        engine.set_transcript_view(
            "a",
            TailEvent::Interrupted { at_ms: T + 1_000 },
            TurnTokens { output: 40, context: None },
        );
        let mut next = state("a", Phase::Thinking, T + 20_000);
        next.turn_started_at = Some(T + 20_000);
        engine.apply_state(next);
        let (snap, _) = engine.snapshot(T + 20_100);
        assert_eq!((snap.sessions[0].phase, snap.sessions[0].tokens_out), (Phase::Thinking, 0));
    }

    #[test]
    fn older_states_are_ignored() {
        let mut engine = Engine::new(EngineConfig::default());
        engine.apply_state(state("a", Phase::Reading, T + 5_000));
        engine.apply_state(state("a", Phase::Thinking, T + 1_000));
        assert_eq!(engine.snapshot(T + 5_100).0.sessions[0].phase, Phase::Reading);
    }

    #[test]
    fn tokens_come_from_the_transcript_for_claude_and_from_the_log_for_codex() {
        let mut engine = Engine::new(EngineConfig::default());
        engine.apply_state(state("a", Phase::Thinking, T));
        engine.set_transcript_view("a", TailEvent::None, TurnTokens { output: 1_284, context: Some(90_000) });
        let mut codex = state("codex-1", Phase::Thinking, T);
        codex.agent = AgentKind::Codex;
        codex.transcript = None;
        codex.tokens_out = Some(321);
        codex.pid = None;
        engine.apply_state(codex);
        let snap = engine.snapshot(T + 100).0;
        let by_id = |id: &str| snap.sessions.iter().find(|v| v.id == id).expect("session").clone();
        assert_eq!((by_id("a").tokens_out, by_id("a").context_tokens), (1_284, Some(90_000)));
        assert_eq!(by_id("codex-1").tokens_out, 321);
    }

    #[test]
    fn dismissing_hides_until_the_next_state_change() {
        let mut engine = Engine::new(EngineConfig::default());
        engine.apply_state(state("a", Phase::Thinking, T));
        engine.dismiss("a");
        assert!(visible_ids(&mut engine, T + 10).is_empty());
        engine.apply_state(state("a", Phase::Reading, T + 500));
        assert_eq!(visible_ids(&mut engine, T + 600), vec!["a"]);
    }

    #[test]
    fn current_sticks_until_it_ends_and_pops_to_a_session_that_finishes() {
        let mut engine = Engine::new(EngineConfig::default());
        let mut a = state("a", Phase::Thinking, T);
        a.turn_started_at = Some(T);
        let mut b = state("b", Phase::Thinking, T + 100);
        b.turn_started_at = Some(T + 50);
        engine.apply_state(a);
        engine.apply_state(b);
        let first = engine.snapshot(T + 200).0;
        assert_eq!(first.sessions.len(), 2);
        assert_eq!(first.current.as_deref(), Some("b"), "newest activity wins at first");
        let mut a_busy = state("a", Phase::Editing, T + 300);
        a_busy.turn_started_at = Some(T);
        engine.apply_state(a_busy);
        assert_eq!(engine.snapshot(T + 400).0.current.as_deref(), Some("b"), "activity elsewhere does not steal focus");
        let mut a_done = state("a", Phase::Done, T + 500);
        a_done.turn_started_at = Some(T);
        engine.apply_state(a_done);
        assert_eq!(engine.snapshot(T + 600).0.current.as_deref(), Some("a"), "a finished session pops to the front");
        assert_eq!(engine.snapshot(T + 6_600).0.current.as_deref(), Some("b"), "and hands back when it collapses");
    }

    #[test]
    fn alerts_fire_once_per_arrival_and_never_for_stale_history() {
        let mut engine = Engine::new(EngineConfig::default());
        let mut done = state("a", Phase::Done, T);
        done.summary = Some("Shipped it".into());
        engine.apply_state(done);
        let (_, alerts) = engine.snapshot(T + 500);
        assert_eq!(alerts.len(), 1);
        assert_eq!((alerts[0].kind, alerts[0].text.as_deref()), (AlertKind::Done, Some("Shipped it")));
        assert!(engine.snapshot(T + 600).1.is_empty(), "announced once");
        let mut old = Engine::new(EngineConfig::default());
        old.apply_state(state("a", Phase::Done, T));
        assert!(old.snapshot(T + ALERT_FRESH_MS + 1).1.is_empty(), "history from before the app started is silent");
        let mut waiting = Engine::new(EngineConfig::default());
        let mut w = state("a", Phase::Waiting, T);
        w.detail = Some("Claude needs your permission to use Bash".into());
        waiting.apply_state(w);
        let alerts = waiting.snapshot(T + 100).1;
        assert_eq!(
            (alerts[0].kind, alerts[0].text.as_deref()),
            (AlertKind::Waiting, Some("Claude needs your permission to use Bash"))
        );
    }

    #[test]
    fn snapshot_seq_only_moves_when_something_visible_changes() {
        let mut engine = Engine::new(EngineConfig::default());
        engine.apply_state(state("a", Phase::Thinking, T));
        let first = engine.snapshot(T + 10).0;
        assert_eq!(engine.snapshot(T + 20).0.seq, first.seq);
        engine.apply_state(state("a", Phase::Reading, T + 100));
        assert!(engine.snapshot(T + 110).0.seq > first.seq);
    }

    #[test]
    fn idle_sessions_are_never_shown_and_old_ones_are_forgotten() {
        let mut engine = Engine::new(EngineConfig::default());
        engine.apply_state(state("a", Phase::Idle, T));
        assert!(visible_ids(&mut engine, T + 1).is_empty());
        assert_eq!(engine.forget_old(T + 7 * 3_600_000), vec!["a".to_owned()]);
        assert!(engine.state_of("a").is_none());
    }

    #[test]
    fn liveness_and_transcript_targets_only_cover_active_sessions() {
        let mut engine = Engine::new(EngineConfig::default());
        engine.apply_state(state("busy", Phase::Running, T));
        engine.apply_state(state("done", Phase::Done, T));
        assert_eq!(engine.liveness_targets().len(), 1);
        assert_eq!(engine.transcript_targets().len(), 1);
        engine.set_alive("busy", false, T + 1);
        assert!(engine.liveness_targets().is_empty());
    }

    #[test]
    fn serialises_to_the_typescript_protocol() {
        let mut engine = Engine::new(EngineConfig::default());
        engine.apply_state(state("a", Phase::Reading, T));
        let json = serde_json::to_value(engine.snapshot(T + 1).0).expect("json");
        assert_eq!(json["current"], "a");
        let view = &json["sessions"][0];
        assert_eq!(view["phase"], "reading");
        assert_eq!(view["agent"], "claude");
        assert!(
            view.get("tokensOut").is_some() && view.get("turnStartedAt").is_some() && view.get("collapseAt").is_some()
        );
    }
}

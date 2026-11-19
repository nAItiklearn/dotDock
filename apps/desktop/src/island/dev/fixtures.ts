import type { AgentKind, Phase, Problem, ProblemKind, SessionView, Snapshot } from "../protocol";

/** DEV ONLY. Sample data for the fixture panel; imported nowhere in the shipped bundle. */

export const ALL_PHASES: readonly Exclude<Phase, "idle">[] = [
  "thinking",
  "reading",
  "searching",
  "editing",
  "running",
  "waiting",
  "done",
  "paused",
  "limit",
  "error",
  "stopped",
];

export const ERROR_KINDS: readonly ProblemKind[] = ["login", "connection", "overloaded", "model", "api"];

export interface Scenario {
  readonly phases: readonly Exclude<Phase, "idle">[];
  readonly errorKind: ProblemKind;
  readonly longDetail: boolean;
  readonly longProject: boolean;
  readonly codexSecond: boolean;
  readonly tokens: number;
  /** When the sample turns began. Kept fixed so the elapsed timer does not restart with every change. */
  readonly epoch: number;
}

export const DEFAULT_SCENARIO: Scenario = {
  phases: [],
  errorKind: "login",
  longDetail: false,
  longProject: false,
  codexSecond: true,
  tokens: 1284,
  epoch: Date.now(),
};

const LONG_DETAIL = "src/components/settings/panels/connections/ConnectionStatusIndicatorWithAVeryLongName.test.tsx";
const LONG_PROJECT = "dotDock-desktop-environment-monorepo-main";
const PROJECTS = ["dotDock", "krova", "haven", "polishot"] as const;
const TITLES = ["Fix login redirect", "Add the tray toggle", "Review the hook installer", "Tidy the grid math"] as const;

const DETAILS: Partial<Record<Exclude<Phase, "idle">, { readonly tool: string; readonly detail: string }>> = {
  reading: { tool: "Read", detail: "SessionStore.tsx" },
  searching: { tool: "Grep", detail: "useIslandStore" },
  editing: { tool: "Edit", detail: "geometry.ts" },
  running: { tool: "Bash", detail: "Run the unit tests" },
  waiting: { tool: "Bash", detail: "Needs permission to run a command" },
};

const SUMMARY = "Moved the toggle into the tray and added tests";

function problemFor(phase: Phase, kind: ProblemKind): Problem | null {
  if (phase === "limit") return { kind: "usage_limit", message: "Session limit", resets: "1:50pm" };
  if (phase !== "error") return null;
  const messages: Record<ProblemKind, string> = {
    usage_limit: "Limit",
    login: "Please run /login",
    connection: "ECONNRESET",
    overloaded: "Overloaded",
    model: "model_not_found",
    api: "API Error: 500 internal server error while streaming the response",
  };
  return { kind, message: messages[kind], resets: null };
}

export function makeSession(index: number, phase: Exclude<Phase, "idle">, scenario: Scenario): SessionView {
  const agent: AgentKind = index === 1 && scenario.codexSecond ? "codex" : "claude";
  const base = DETAILS[phase];
  const turnStartedAt = scenario.epoch - (42 + index * 17) * 1000;
  return {
    id: `fixture-${index}`,
    agent,
    phase,
    tool: base?.tool ?? null,
    detail: base ? (scenario.longDetail ? LONG_DETAIL : base.detail) : null,
    project: scenario.longProject ? LONG_PROJECT : (PROJECTS[index % PROJECTS.length] as string),
    title: TITLES[index % TITLES.length] as string,
    summary: phase === "done" ? SUMMARY : null,
    problem: problemFor(phase, scenario.errorKind),
    tokensOut: scenario.tokens + index * 4200,
    contextTokens: 91_000,
    turnStartedAt,
    updatedAt: scenario.epoch,
    collapseAt: null,
  };
}

export function buildSnapshot(scenario: Scenario, seq: number, current: string | null): Snapshot {
  const sessions = scenario.phases.map((phase, i) => makeSession(i, phase, scenario));
  const keep = current !== null && sessions.some((s) => s.id === current) ? current : (sessions[0]?.id ?? null);
  return { seq, sessions, current: keep };
}

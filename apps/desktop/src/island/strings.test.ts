import { describe, expect, it } from "vitest";
import type { Phase, Problem, SessionView } from "./protocol";
import { connectionDetail, connectionLabel, describeSession, detailLine, t } from "./strings";

function session(phase: Phase, patch: Partial<SessionView> = {}): SessionView {
  return {
    id: "s1",
    agent: "claude",
    agentLabel: "Claude Code",
    phase,
    tool: null,
    detail: null,
    project: "dotDock",
    title: null,
    summary: null,
    problem: null,
    tokensOut: 0,
    contextTokens: null,
    turnStartedAt: null,
    updatedAt: 0,
    collapseAt: null,
    ...patch,
  };
}

const problem = (patch: Partial<Problem>): Problem => ({ kind: "api", message: "", resets: null, ...patch });

describe("t", () => {
  it("fills named parameters and leaves unknown ones visible", () => {
    expect(t("aria.focus", { project: "krova" })).toBe("Show the terminal for krova");
    expect(t("aria.session", { index: 2, count: 3 })).toBe("Session 2 of 3");
    expect(t("hint.limit.resets", {})).toBe("resets {when}");
  });
});

describe("describeSession", () => {
  it("names every working phase", () => {
    expect(describeSession(session("thinking")).word).toBe("Thinking");
    expect(describeSession(session("reading", { tool: "Read" })).word).toBe("Reading");
    expect(describeSession(session("searching", { tool: "Grep" })).word).toBe("Searching");
    expect(describeSession(session("editing", { tool: "Edit" })).word).toBe("Editing");
    expect(describeSession(session("running", { tool: "Bash" })).word).toBe("Running");
  });

  it("lets a few tools say more than the phase", () => {
    expect(describeSession(session("editing", { tool: "Write" })).word).toBe("Writing");
    expect(describeSession(session("reading", { tool: "WebFetch" })).word).toBe("Fetching");
    expect(describeSession(session("editing", { tool: "Agent" })).word).toBe("Delegating");
    expect(describeSession(session("editing", { tool: "mcp__github__create_issue" })).word).toBe("Calling tool");
  });

  it("words the terminal and attention phases", () => {
    expect(describeSession(session("waiting")).word).toBe("Needs you");
    expect(describeSession(session("done")).word).toBe("Done");
    expect(describeSession(session("paused")).word).toBe("Paused");
    expect(describeSession(session("stopped")).word).toBe("Stopped");
    expect(describeSession(session("idle")).word).toBe("Ready");
  });

  it("explains a usage limit with its kind and reset time", () => {
    const limit = session("limit", { problem: problem({ kind: "usage_limit", message: "Session limit", resets: "1:50pm" }) });
    expect(describeSession(limit)).toEqual({ word: "Limit reached", hint: "Session limit · resets 1:50pm" });
    expect(describeSession(session("limit", { problem: problem({ kind: "usage_limit" }) })).hint).toBe("Usage limit");
  });

  it.each([
    ["login", "Signed out", "Run /login in the terminal"],
    ["connection", "Offline", "Check your connection and resend"],
    ["overloaded", "Busy", "Server busy, resend in a moment"],
    ["model", "Model unavailable", "Pick another one in the terminal"],
  ] as const)("describes a %s error", (kind, word, hint) => {
    expect(describeSession(session("error", { problem: problem({ kind }) }))).toEqual({ word, hint });
  });

  it("passes an unclassified API error message through and falls back without a problem", () => {
    expect(describeSession(session("error", { problem: problem({ kind: "api", message: "500 internal" }) }))).toEqual({
      word: "API error",
      hint: "500 internal",
    });
    expect(describeSession(session("error")).word).toBe("API error");
  });

  it("names the agent that is signed out, and keeps /login for Claude Code only", () => {
    const hintFor = (agent: SessionView["agent"], agentLabel: string): string | null =>
      describeSession(session("error", { agent, agentLabel, problem: problem({ kind: "login" }) })).hint;
    expect(hintFor("claude", "Claude Code")).toBe("Run /login in the terminal");
    expect(hintFor("codex", "Codex")).toBe("Sign in to Codex again");
    expect(hintFor("copilot", "GitHub Copilot CLI")).toBe("Sign in to GitHub Copilot CLI again");
    expect(hintFor("other", "Aider")).toBe("Sign in to Aider again");
  });
});

describe("detailLine", () => {
  it("shows what the tool is touching, then the session title", () => {
    expect(detailLine(session("reading", { detail: "App.tsx", title: "Fix it" }))).toBe("App.tsx");
    expect(detailLine(session("thinking", { title: "Fix it" }))).toBe("Fix it");
    expect(detailLine(session("thinking"))).toBeNull();
  });

  it("shows the summary once done", () => {
    expect(detailLine(session("done", { summary: "Moved the toggle", title: "Fix it" }))).toBe("Moved the toggle");
    expect(detailLine(session("done", { title: "Fix it" }))).toBe("Fix it");
  });

  it("shows the hint for phases that explain themselves", () => {
    expect(detailLine(session("paused"))).toBe("Interrupted");
    expect(detailLine(session("stopped"))).toBe("Session closed");
    expect(detailLine(session("waiting"))).toBe("Approve in the terminal");
    expect(detailLine(session("waiting", { detail: "Needs permission to run a command" }))).toBe("Needs permission to run a command");
    expect(detailLine(session("error", { problem: problem({ kind: "login" }) }))).toBe("Run /login in the terminal");
  });
});

describe("connection copy", () => {
  it("has a label and an explanation for every state", () => {
    for (const state of ["no-claude", "disconnected", "connected", "outdated", "hook-missing"] as const) {
      expect(connectionLabel(state).length).toBeGreaterThan(0);
      expect(connectionDetail(state).length).toBeGreaterThan(0);
    }
  });
});

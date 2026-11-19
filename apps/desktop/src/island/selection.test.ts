import { describe, expect, it } from "vitest";
import type { Phase, SessionView, Snapshot } from "./protocol";
import { directionBetween, pruneUnavailablePin, resolveCurrent, stepSession } from "./selection";

function view(id: string, phase: Phase = "thinking"): SessionView {
  return {
    id,
    agent: "claude",
    phase,
    tool: null,
    detail: null,
    project: "p",
    title: null,
    summary: null,
    problem: null,
    tokensOut: 0,
    contextTokens: null,
    turnStartedAt: null,
    updatedAt: 0,
    collapseAt: null,
  };
}

const snapshot = (ids: readonly string[], current: string | null = ids[0] ?? null): Snapshot => ({
  seq: 1,
  sessions: ids.map((id) => view(id)),
  current,
});

describe("resolveCurrent", () => {
  it("follows the core's suggestion when nothing is pinned", () => {
    expect(resolveCurrent(snapshot(["a", "b"], "b"), null)?.id).toBe("b");
  });

  it("keeps the session the user picked while it is visible", () => {
    expect(resolveCurrent(snapshot(["a", "b"], "a"), "b")?.id).toBe("b");
  });

  it("falls back to the suggestion when the pinned session is gone", () => {
    expect(resolveCurrent(snapshot(["a", "c"], "c"), "b")?.id).toBe("c");
  });

  it("falls back to the first session when the suggestion is missing, and to null when idle", () => {
    expect(resolveCurrent(snapshot(["a", "b"], "zzz"), null)?.id).toBe("a");
    expect(resolveCurrent(snapshot([], null), "a")).toBeNull();
  });
});

describe("stepSession", () => {
  it("moves one session at a time and stops at the ends", () => {
    const s = snapshot(["a", "b", "c"]);
    expect(stepSession(s, "a", 1)).toBe("b");
    expect(stepSession(s, "b", -1)).toBe("a");
    expect(stepSession(s, "c", 1)).toBeNull();
    expect(stepSession(s, "a", -1)).toBeNull();
  });

  it("does nothing when the current session is unknown", () => {
    expect(stepSession(snapshot(["a"]), "x", 1)).toBeNull();
    expect(stepSession(snapshot(["a"]), null, 1)).toBeNull();
  });
});

describe("pruneUnavailablePin", () => {
  it("keeps a pin that is still visible and drops one that is not", () => {
    expect(pruneUnavailablePin(snapshot(["a", "b"]), "b")).toBe("b");
    expect(pruneUnavailablePin(snapshot(["a"]), "b")).toBeNull();
    expect(pruneUnavailablePin(snapshot(["a"]), null)).toBeNull();
  });
});

describe("directionBetween", () => {
  it("slides forward to a later session and back to an earlier one", () => {
    const s = snapshot(["a", "b", "c"]);
    expect(directionBetween(s, "a", "c")).toBe(1);
    expect(directionBetween(s, "c", "a")).toBe(-1);
    expect(directionBetween(s, null, "b")).toBe(1);
  });
});

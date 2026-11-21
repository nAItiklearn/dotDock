import { beforeEach, describe, expect, it } from "vitest";
import type { Phase, SessionView, Snapshot } from "./protocol";
import { DEFAULT_SETTINGS } from "./protocol";
import { EMPTY_SNAPSHOT, useIslandStore } from "./store";

function view(id: string, phase: Phase = "thinking"): SessionView {
  return {
    id,
    agent: "claude",
    agentLabel: "Claude Code",
    phase,
    tool: null,
    detail: null,
    project: id,
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

let seq = 0;
const snapshot = (ids: readonly string[], current: string | null = ids[0] ?? null): Snapshot => ({ seq: ++seq, sessions: ids.map((id) => view(id)), current });
const state = () => useIslandStore.getState();

beforeEach(() => {
  useIslandStore.setState({ snapshot: EMPTY_SNAPSHOT, settings: DEFAULT_SETTINGS, connection: null, pinnedId: null, direction: 1, pointerInside: false, flash: null });
});

describe("pinning", () => {
  it("pins a session and remembers which way the content should slide", () => {
    state().applySnapshot(snapshot(["a", "b", "c"]));
    state().pin("c");
    expect(state().pinnedId).toBe("c");
    expect(state().direction).toBe(1);
    state().pin("a");
    expect(state().direction).toBe(-1);
  });

  it("steps through sessions and stops at the ends", () => {
    state().applySnapshot(snapshot(["a", "b"]));
    state().step(1);
    expect(state().pinnedId).toBe("b");
    state().step(1);
    expect(state().pinnedId).toBe("b");
    state().step(-1);
    expect(state().pinnedId).toBe("a");
    expect(state().direction).toBe(-1);
  });

  it("drops the pin when its session disappears", () => {
    state().applySnapshot(snapshot(["a", "b"]));
    state().pin("b");
    state().applySnapshot(snapshot(["a"]));
    expect(state().pinnedId).toBeNull();
  });

  it("starts from the suggested session when stepping without a pin", () => {
    state().applySnapshot(snapshot(["a", "b", "c"], "b"));
    state().step(1);
    expect(state().pinnedId).toBe("c");
  });
});

describe("flash", () => {
  it("clears itself when the session it belongs to leaves", () => {
    state().applySnapshot(snapshot(["a"]));
    state().setFlash({ sessionId: "a", kind: "window-not-found" });
    state().applySnapshot(snapshot(["a"]));
    expect(state().flash).not.toBeNull();
    state().applySnapshot(snapshot([]));
    expect(state().flash).toBeNull();
  });
});

describe("pointer", () => {
  it("keeps the same state object when the pointer did not move in or out", () => {
    state().setPointerInside(true);
    const before = state();
    state().setPointerInside(true);
    expect(state()).toBe(before);
  });
});

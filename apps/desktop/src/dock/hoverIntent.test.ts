import { describe, expect, it } from "vitest";
import { IDLE, nextPreview, previewKey, PREVIEW_DELAY_MS, PREVIEW_GRACE_MS, wakeupIn, type PreviewState } from "./hoverIntent";

const step = (state: PreviewState, ...events: Parameters<typeof nextPreview>[1][]): PreviewState => events.reduce(nextPreview, state);

describe("preview intent", () => {
  it("opens only after the pointer has dwelled on a running app", () => {
    const pending = step(IDLE, { type: "enter", key: "a", now: 0 });
    expect(previewKey(pending)).toBeNull();
    expect(step(pending, { type: "tick", now: PREVIEW_DELAY_MS - 1 }).phase).toBe("pending");
    expect(step(pending, { type: "tick", now: PREVIEW_DELAY_MS })).toEqual({ phase: "open", key: "a" });
  });

  it("does not open when the pointer leaves first", () => {
    expect(step(IDLE, { type: "enter", key: "a", now: 0 }, { type: "leave", now: 100 })).toEqual(IDLE);
  });

  it("restarts the dwell when the pointer moves to another app before opening", () => {
    const moved = step(IDLE, { type: "enter", key: "a", now: 0 }, { type: "enter", key: "b", now: 200 });
    expect(step(moved, { type: "tick", now: 200 + PREVIEW_DELAY_MS - 1 }).phase).toBe("pending");
  });

  it("keeps counting when the same app is entered again", () => {
    const first = step(IDLE, { type: "enter", key: "a", now: 0 });
    expect(step(first, { type: "enter", key: "a", now: 50 })).toBe(first);
  });

  it("switches at once while a preview is open", () => {
    const open: PreviewState = { phase: "open", key: "a" };
    expect(step(open, { type: "enter", key: "b", now: 10 })).toEqual({ phase: "open", key: "b" });
  });

  it("closes after a grace period, and re-entering the panel in time keeps it open", () => {
    const closing = step({ phase: "open", key: "a" }, { type: "leave", now: 1000 });
    expect(previewKey(closing)).toBe("a");
    expect(step(closing, { type: "tick", now: 1000 + PREVIEW_GRACE_MS - 1 }).phase).toBe("closing");
    expect(step(closing, { type: "tick", now: 1000 + PREVIEW_GRACE_MS })).toEqual(IDLE);
    expect(step(closing, { type: "enter", key: "a", now: 1100 })).toEqual({ phase: "open", key: "a" });
  });

  it("asks for a wake-up only while waiting on a timer", () => {
    expect(wakeupIn(IDLE, 0)).toBeNull();
    expect(wakeupIn({ phase: "open", key: "a" }, 0)).toBeNull();
    expect(wakeupIn({ phase: "pending", key: "a", since: 100 }, 150)).toBe(PREVIEW_DELAY_MS - 50);
    expect(wakeupIn({ phase: "closing", key: "a", since: 0 }, 10_000)).toBe(0);
  });
});

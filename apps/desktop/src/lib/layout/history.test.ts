import { describe, expect, it } from "vitest";
import { canRedo, canUndo, createHistory, HISTORY_LIMIT, pushHistory, redoHistory, undoHistory } from "./history";

describe("history", () => {
  it("starts with nothing to undo or redo", () => {
    const h = createHistory("a");
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("undoes and redoes in order", () => {
    let h = createHistory("a");
    h = pushHistory(h, "b");
    h = pushHistory(h, "c");
    expect(h.present).toBe("c");
    h = undoHistory(h);
    expect(h.present).toBe("b");
    h = undoHistory(h);
    expect(h.present).toBe("a");
    expect(canUndo(h)).toBe(false);
    h = redoHistory(h);
    h = redoHistory(h);
    expect(h.present).toBe("c");
    expect(canRedo(h)).toBe(false);
  });

  it("drops the redo branch when a new step is recorded after an undo", () => {
    let h = pushHistory(pushHistory(createHistory("a"), "b"), "c");
    h = undoHistory(h);
    h = pushHistory(h, "d");
    expect(h.present).toBe("d");
    expect(canRedo(h)).toBe(false);
    expect(undoHistory(h).present).toBe("b");
  });

  it("ignores a push of the identical state", () => {
    const state = { n: 1 };
    const h = createHistory(state);
    expect(pushHistory(h, state)).toBe(h);
  });

  it("keeps exactly 50 undo steps", () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = pushHistory(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    let steps = 0;
    while (canUndo(h)) {
      h = undoHistory(h);
      steps++;
    }
    expect(steps).toBe(50);
    expect(h.present).toBe(20);
  });

  it("undo and redo at the ends are no-ops", () => {
    const h = createHistory("a");
    expect(undoHistory(h)).toBe(h);
    expect(redoHistory(h)).toBe(h);
  });
});

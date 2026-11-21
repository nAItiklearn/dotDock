import { describe, expect, it } from "vitest";
import type { SizeSpec } from "../../widgets/sizes";
import {
  cellAtPoint,
  centredOrigin,
  classifyPress,
  DIRECT_DRAG_PX,
  DRAG_THRESHOLD_PX,
  dragTarget,
  HOLD_MS,
  HOLD_SLOP_PX,
  passedDragThreshold,
  sizesByProximity,
} from "./gesture";
import type { GridMetrics } from "./grid";

const M: GridMetrics = { cell: 76, gap: 12, edge: 28 };

describe("drag snapping", () => {
  it("snaps to the nearest cell, so a drag crossing half a pitch changes the target", () => {
    expect(dragTarget({ x: 2, y: 3 }, 0, 0, M)).toEqual({ x: 2, y: 3 });
    expect(dragTarget({ x: 2, y: 3 }, 43, -43, M)).toEqual({ x: 2, y: 3 });
    expect(dragTarget({ x: 2, y: 3 }, 44, -44, M)).toEqual({ x: 3, y: 2 });
    expect(dragTarget({ x: 2, y: 3 }, 88 * 5 + 10, 88 * 2, M)).toEqual({ x: 7, y: 5 });
  });

  it("can target cells off the grid; the layout clamps them", () => {
    expect(dragTarget({ x: 0, y: 0 }, -500, -500, M)).toEqual({ x: -6, y: -6 });
  });

  it("treats a tiny wobble as a click, not a drag", () => {
    expect(passedDragThreshold(1, 1)).toBe(false);
    expect(passedDragThreshold(DRAG_THRESHOLD_PX, 0)).toBe(true);
    expect(passedDragThreshold(-3, 3)).toBe(true);
  });
});

describe("resize snapping", () => {
  const sizes: SizeSpec[] = [
    { id: "s", name: "Small", w: 2, h: 1 },
    { id: "m", name: "Medium", w: 6, h: 2 },
    { id: "l", name: "Large", w: 9, h: 3 },
  ];

  it("orders declared sizes by distance to the pointer's corner", () => {
    // Medium is 6 cells wide x 2 tall: 516 x 164 px.
    expect(sizesByProximity(sizes, 520, 170, M).map((s) => s.id)).toEqual(["m", "l", "s"]);
    expect(sizesByProximity(sizes, 100, 60, M)[0]?.id).toBe("s");
    expect(sizesByProximity(sizes, 900, 400, M)[0]?.id).toBe("l");
  });

  it("is stable for a single size", () => {
    expect(sizesByProximity([sizes[0] as SizeSpec], 9999, 9999, M)).toHaveLength(1);
  });

  it("does not modify the declared list", () => {
    const before = sizes.map((s) => s.id).join();
    sizesByProximity(sizes, 900, 400, M);
    expect(sizes.map((s) => s.id).join()).toBe(before);
  });
});

describe("direct press on the plain desktop", () => {
  it("waits on a still press, lifts after the hold, and drags on real travel", () => {
    expect(classifyPress(HOLD_MS - 1, 0, 0)).toBe("pending");
    expect(classifyPress(HOLD_MS, HOLD_SLOP_PX, 0)).toBe("hold");
    expect(classifyPress(10, DIRECT_DRAG_PX, 0)).toBe("drag");
  });

  it("treats a wobble past the hold slop but short of a drag as neither", () => {
    expect(classifyPress(HOLD_MS * 2, HOLD_SLOP_PX + 1, 0)).toBe("none");
  });
});

describe("pointing at a cell", () => {
  it("finds the cell under a point and clamps to the grid", () => {
    const bounds = { cols: 16, rows: 9 };
    expect(cellAtPoint(M.edge + 1, M.edge + 1, M, bounds)).toEqual({ x: 0, y: 0 });
    expect(cellAtPoint(M.edge + 88 * 3 + 5, M.edge + 88 * 2 + 5, M, bounds)).toEqual({ x: 3, y: 2 });
    expect(cellAtPoint(-100, 99999, M, bounds)).toEqual({ x: 0, y: 8 });
  });

  it("centres a new widget on the pointed cell without leaving the grid", () => {
    expect(centredOrigin({ x: 5, y: 4 }, 4, 2)).toEqual({ x: 4, y: 4 });
    expect(centredOrigin({ x: 0, y: 0 }, 4, 2)).toEqual({ x: 0, y: 0 });
  });
});

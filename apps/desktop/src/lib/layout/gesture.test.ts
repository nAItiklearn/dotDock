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
  MAGNET_PX,
  magnetize,
  passedDragThreshold,
  sizesByProximity,
} from "./gesture";
import { POSITION_STEPS, quantize, type GridMetrics } from "./grid";

const M: GridMetrics = { cell: 76, gap: 12, edge: 28 };

describe("free dragging", () => {
  it("follows the pointer exactly, to the nearest position step, with no coarse grid", () => {
    expect(dragTarget({ x: 2, y: 3 }, 0, 0, M)).toEqual({ x: 2, y: 3 });
    // 44 px is half a pitch: half a cell, not a jump to the next cell.
    expect(dragTarget({ x: 2, y: 3 }, 44, -44, M)).toEqual({ x: 2.5, y: 2.5 });
    expect(dragTarget({ x: 2, y: 3 }, 11, 0, M)).toEqual({ x: 2.125, y: 3 });
    const t = dragTarget({ x: 0, y: 0 }, 7, 0, M);
    expect(t.x * POSITION_STEPS).toBe(Math.round(t.x * POSITION_STEPS));
  });

  it("can target spots off the grid; the layout clamps them", () => {
    expect(dragTarget({ x: 0, y: 0 }, -528, -528, M)).toEqual({ x: -6, y: -6 });
  });

  it("treats a tiny wobble as a click, not a drag", () => {
    expect(passedDragThreshold(1, 1)).toBe(false);
    expect(passedDragThreshold(DRAG_THRESHOLD_PX, 0)).toBe(true);
    expect(passedDragThreshold(-3, 3)).toBe(true);
  });
});

describe("soft magnet", () => {
  const bounds = { cols: 16, rows: 9 };
  const near = MAGNET_PX / 2 / 88;
  const far = (MAGNET_PX * 2) / 88;
  const other = { x: 4, y: 2, w: 2, h: 2 };

  it("pulls a nearby edge into line with a neighbour's edge, centre, or the gap beside it", () => {
    expect(magnetize({ x: 4 + near, y: 6, w: 2, h: 2 }, [other], bounds, M).x).toBe(4);
    expect(magnetize({ x: 6 - near, y: 6, w: 2, h: 2 }, [other], bounds, M).x).toBe(6);
    expect(magnetize({ x: 4.5 + near, y: 6, w: 1, h: 1 }, [other], bounds, M).x).toBe(4.5);
  });

  it("pulls to the screen edges", () => {
    expect(magnetize({ x: near, y: 9 - 2 - near, w: 2, h: 2 }, [], bounds, M)).toEqual({ x: 0, y: 7 });
  });

  it("leaves a widget exactly where it is when nothing is close", () => {
    const x = 9 + far;
    expect(magnetize({ x, y: 4.25, w: 2, h: 2 }, [other], bounds, M)).toEqual({ x: quantize(x), y: 4.25 });
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

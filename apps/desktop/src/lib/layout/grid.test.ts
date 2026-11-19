import { describe, expect, it } from "vitest";
import type { Rect } from "../model/types";
import {
  boundsFor,
  cellStartPx,
  clampRect,
  firstFreeSpot,
  fitsBounds,
  nearestFreeSpot,
  rectsOverlap,
  rectToPx,
  roundToCell,
  spanPx,
  type GridMetrics,
} from "./grid";

const M: GridMetrics = { cell: 76, gap: 12, edge: 28 };

describe("grid geometry", () => {
  it("converts cells to pixels with gaps between cells only", () => {
    expect(cellStartPx(0, M)).toBe(28);
    expect(cellStartPx(2, M)).toBe(28 + 2 * 88);
    expect(spanPx(1, M)).toBe(76);
    expect(spanPx(3, M)).toBe(3 * 76 + 2 * 12);
    expect(rectToPx({ x: 1, y: 2, w: 2, h: 1 }, M)).toEqual({ left: 116, top: 204, width: 164, height: 76 });
  });

  it("snaps a pixel delta to the nearest cell, half a pitch rounding up", () => {
    expect(roundToCell(0, M)).toBe(0);
    expect(roundToCell(43, M)).toBe(0);
    expect(roundToCell(44, M)).toBe(1);
    expect(roundToCell(-43, M)).toBe(0);
    expect(roundToCell(-44, M)).toBe(-1);
    expect(roundToCell(-60, M)).toBe(-1);
    expect(roundToCell(88 * 3 + 10, M)).toBe(3);
  });

  it("counts the cells that fit between the safe margins", () => {
    // 1920x1080 at 125%: 1536x864 CSS px.
    expect(boundsFor(1536, 864, M)).toEqual({ cols: 16, rows: 9 });
    expect(boundsFor(1280, 720, M)).toEqual({ cols: 14, rows: 7 });
  });

  it("never collapses below one cell, even in a tiny viewport", () => {
    expect(boundsFor(10, 10, M)).toEqual({ cols: 1, rows: 1 });
  });

  it("shrinks the grid when the edge margin grows", () => {
    expect(boundsFor(1280, 720, { ...M, edge: 96 })).toEqual({ cols: 12, rows: 6 });
  });
});

describe("rectangles", () => {
  const a: Rect = { x: 0, y: 0, w: 2, h: 2 };

  it("treats touching rectangles as not overlapping", () => {
    expect(rectsOverlap(a, { x: 2, y: 0, w: 1, h: 1 })).toBe(false);
    expect(rectsOverlap(a, { x: 0, y: 2, w: 1, h: 1 })).toBe(false);
    expect(rectsOverlap(a, { x: 1, y: 1, w: 1, h: 1 })).toBe(true);
  });

  it("detects containment and partial overlap", () => {
    expect(rectsOverlap(a, { x: 0, y: 0, w: 5, h: 5 })).toBe(true);
    expect(rectsOverlap({ x: 1, y: 1, w: 1, h: 1 }, a)).toBe(true);
  });

  it("clamps into bounds and returns the same object when nothing changes", () => {
    const bounds = { cols: 6, rows: 4 };
    expect(clampRect({ x: 5, y: 3, w: 2, h: 2 }, bounds)).toEqual({ x: 4, y: 2, w: 2, h: 2 });
    expect(clampRect({ x: -3, y: -1, w: 1, h: 1 }, bounds)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(clampRect(a, bounds)).toBe(a);
  });

  it("pins a rectangle larger than the bounds to the origin", () => {
    const clamped = clampRect({ x: 2, y: 2, w: 9, h: 9 }, { cols: 4, rows: 4 });
    expect(clamped).toMatchObject({ x: 0, y: 0 });
    expect(fitsBounds(clamped, { cols: 4, rows: 4 })).toBe(false);
  });
});

describe("free spots", () => {
  const bounds = { cols: 4, rows: 3 };

  it("finds the first free spot in reading order", () => {
    const occupied: Rect[] = [{ x: 0, y: 0, w: 2, h: 3 }];
    expect(firstFreeSpot(occupied, 2, 2, bounds)).toEqual({ x: 2, y: 0 });
    expect(firstFreeSpot([...occupied, { x: 2, y: 0, w: 2, h: 3 }], 1, 1, bounds)).toBeNull();
  });

  it("finds the free spot nearest a point, earlier row winning ties", () => {
    const occupied: Rect[] = [{ x: 1, y: 1, w: 2, h: 1 }];
    expect(nearestFreeSpot(occupied, 1, 1, bounds, { x: 1, y: 1 })).toEqual({ x: 1, y: 0 });
  });

  it("returns null when the widget is larger than the grid", () => {
    expect(nearestFreeSpot([], 5, 1, bounds)).toBeNull();
    expect(firstFreeSpot([], 1, 4, bounds)).toBeNull();
  });
});

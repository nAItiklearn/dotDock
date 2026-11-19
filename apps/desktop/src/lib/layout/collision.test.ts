import { describe, expect, it } from "vitest";
import type { Rect } from "../model/types";
import { normalizeArrangement, resolveMove, resolvePush, resolveSwap, type Item } from "./collision";
import { rectsOverlap } from "./grid";

const bounds = { cols: 8, rows: 6 };

const item = (id: string, x: number, y: number, w: number, h: number): Item => ({ id, x, y, w, h });

function noOverlaps(arrangement: ReadonlyMap<string, Rect>): boolean {
  const all = [...arrangement.values()];
  return all.every((a, i) => all.every((b, j) => i === j || !rectsOverlap(a, b)));
}

function insideBounds(arrangement: ReadonlyMap<string, Rect>): boolean {
  return [...arrangement.values()].every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= bounds.cols && r.y + r.h <= bounds.rows);
}

describe("push collisions", () => {
  const items = [item("a", 0, 0, 2, 2), item("b", 3, 0, 2, 2), item("c", 0, 3, 2, 2)];

  it("moves into free space without disturbing anyone", () => {
    const result = resolvePush(items, "a", { x: 5, y: 3, w: 2, h: 2 }, bounds);
    expect(result?.get("a")).toEqual({ x: 5, y: 3, w: 2, h: 2 });
    expect(result?.get("b")).toEqual({ x: 3, y: 0, w: 2, h: 2 });
    expect(result?.get("c")).toEqual({ x: 0, y: 3, w: 2, h: 2 });
  });

  it("pushes the widget it lands on by the smallest distance", () => {
    // Dropping a on b's left half: b is one column from clearing to the right (x=4)...
    const result = resolvePush(items, "a", { x: 2, y: 0, w: 2, h: 2 }, bounds);
    expect(result).not.toBeNull();
    const b = result?.get("b");
    expect(b).toBeDefined();
    expect(rectsOverlap(result?.get("a") as Rect, b as Rect)).toBe(false);
    expect(b).toEqual({ x: 4, y: 0, w: 2, h: 2 });
  });

  it("prefers pushing down when down and right cost the same", () => {
    const result = resolvePush([item("a", 0, 0, 2, 2), item("b", 4, 2, 2, 2)], "a", { x: 3, y: 1, w: 2, h: 2 }, bounds);
    expect(result?.get("b")).toEqual({ x: 4, y: 3, w: 2, h: 2 });
  });

  it("cascades: a pushed widget pushes the next one", () => {
    const row = [item("a", 0, 0, 2, 2), item("b", 2, 2, 2, 2), item("c", 2, 4, 2, 2)];
    const result = resolvePush(row, "a", { x: 2, y: 1, w: 2, h: 2 }, bounds);
    expect(result).not.toBeNull();
    expect(noOverlaps(result as Map<string, Rect>)).toBe(true);
    expect(insideBounds(result as Map<string, Rect>)).toBe(true);
  });

  it("keeps the moved widget exactly where it was dropped", () => {
    const result = resolvePush(items, "a", { x: 2, y: 1, w: 2, h: 2 }, bounds);
    expect(result?.get("a")).toEqual({ x: 2, y: 1, w: 2, h: 2 });
  });

  it("clamps a drop that would leave the screen", () => {
    const result = resolvePush(items, "a", { x: 7, y: 5, w: 2, h: 2 }, bounds);
    expect(result?.get("a")).toEqual({ x: 6, y: 4, w: 2, h: 2 });
  });

  it("refuses a move that would push a widget off the grid", () => {
    // One row, three columns: b is two wide and cannot go left or right of a without leaving the grid.
    const tight = { cols: 3, rows: 1 };
    const result = resolvePush([item("a", 0, 0, 1, 1), item("b", 1, 0, 2, 1)], "a", { x: 1, y: 0, w: 1, h: 1 }, tight);
    expect(result).toBeNull();
  });

  it("refuses a drop that would rearrange more than three neighbours instead of reshuffling the desktop", () => {
    const crowd = [
      item("m", 0, 5, 4, 1),
      item("a", 2, 2, 1, 1),
      item("b", 3, 2, 1, 1),
      item("c", 4, 2, 1, 1),
      item("d", 2, 3, 1, 1),
      item("e", 3, 3, 1, 1),
    ];
    expect(resolvePush(crowd, "m", { x: 2, y: 2, w: 4, h: 2 }, bounds)).toBeNull();
  });

  it("moves three neighbours when it must, and no more than it must", () => {
    const row = [item("m", 0, 5, 3, 1), item("a", 1, 1, 1, 1), item("b", 2, 1, 1, 1), item("c", 3, 1, 1, 1), item("far", 6, 5, 1, 1)];
    const result = resolvePush(row, "m", { x: 1, y: 1, w: 3, h: 1 }, bounds);
    expect(result).not.toBeNull();
    expect(noOverlaps(result as Map<string, Rect>)).toBe(true);
    expect(result?.get("far")).toEqual({ x: 6, y: 5, w: 1, h: 1 });
  });

  it("chooses the arrangement that moves neighbours least overall, not just the first that works", () => {
    // Dropping a 2x2 on b: pushing b right is one step, but then b would hit c. Pushing b down clears everything.
    const items3 = [item("a", 0, 0, 2, 2), item("b", 2, 0, 2, 2), item("c", 4, 0, 2, 2)];
    const result = resolvePush(items3, "a", { x: 1, y: 0, w: 2, h: 2 }, bounds);
    expect(result?.get("b")).toEqual({ x: 2, y: 2, w: 2, h: 2 });
    expect(result?.get("c")).toEqual({ x: 4, y: 0, w: 2, h: 2 });
  });

  it("refuses a widget larger than the grid", () => {
    expect(resolvePush(items, "a", { x: 0, y: 0, w: 9, h: 2 }, bounds)).toBeNull();
  });

  it("leaves the input untouched", () => {
    const before = JSON.stringify(items);
    resolvePush(items, "a", { x: 2, y: 0, w: 2, h: 2 }, bounds);
    expect(JSON.stringify(items)).toBe(before);
  });
});

describe("swap collisions", () => {
  it("swaps two equal widgets", () => {
    const result = resolveSwap([item("a", 0, 0, 2, 2), item("b", 4, 0, 2, 2)], "a", { x: 4, y: 0, w: 2, h: 2 }, bounds);
    expect(result?.get("a")).toEqual({ x: 4, y: 0, w: 2, h: 2 });
    expect(result?.get("b")).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });

  it("moves into empty space like a normal move", () => {
    const result = resolveSwap([item("a", 0, 0, 2, 2), item("b", 4, 0, 2, 2)], "a", { x: 0, y: 3, w: 2, h: 2 }, bounds);
    expect(result?.get("a")).toEqual({ x: 0, y: 3, w: 2, h: 2 });
    expect(result?.get("b")).toEqual({ x: 4, y: 0, w: 2, h: 2 });
  });

  it("swaps a small widget with a larger one when the larger fits in its place", () => {
    const result = resolveSwap([item("a", 0, 0, 1, 1), item("b", 3, 0, 2, 1)], "a", { x: 3, y: 0, w: 1, h: 1 }, bounds);
    expect(result?.get("b")).toEqual({ x: 0, y: 0, w: 2, h: 1 });
  });

  it("declines when more than one widget is under the drop", () => {
    const three = [item("a", 0, 0, 2, 2), item("b", 3, 0, 2, 2), item("c", 3, 2, 2, 2)];
    expect(resolveSwap(three, "a", { x: 3, y: 1, w: 2, h: 2 }, bounds)).toBeNull();
  });

  it("declines when the displaced widget would not fit the old place", () => {
    // b is three wide; moved into c's old spot it would run over d.
    const crowded = [item("a", 0, 0, 1, 1), item("b", 1, 0, 3, 1), item("c", 0, 1, 1, 1), item("d", 1, 1, 1, 1)];
    expect(resolveSwap(crowded, "c", { x: 1, y: 0, w: 1, h: 1 }, bounds)).toBeNull();
  });
});

describe("resolveMove", () => {
  it("falls back to push when a swap is impossible", () => {
    const three = [item("a", 0, 0, 2, 2), item("b", 3, 0, 2, 2), item("c", 3, 2, 2, 2)];
    const result = resolveMove(three, "a", { x: 3, y: 1, w: 2, h: 2 }, "swap", bounds);
    expect(result).not.toBeNull();
    expect(noOverlaps(result as Map<string, Rect>)).toBe(true);
  });

  it("uses push directly in push mode, even where a swap would work", () => {
    const result = resolveMove([item("a", 0, 0, 2, 2), item("b", 4, 0, 2, 2)], "a", { x: 3, y: 0, w: 2, h: 2 }, "push", bounds);
    expect(result?.get("a")).toEqual({ x: 3, y: 0, w: 2, h: 2 });
    expect(result?.get("b")).not.toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });
});

describe("normalizeArrangement", () => {
  it("keeps a valid layout exactly as it is", () => {
    const valid = [item("a", 0, 0, 2, 2), item("b", 2, 0, 2, 2)];
    const result = normalizeArrangement(valid, bounds);
    expect(result.get("a")).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(result.get("b")).toEqual({ x: 2, y: 0, w: 2, h: 2 });
  });

  it("pulls widgets from a bigger screen back inside a smaller one", () => {
    const result = normalizeArrangement([item("a", 20, 10, 2, 2)], bounds);
    expect(result.get("a")).toEqual({ x: 6, y: 4, w: 2, h: 2 });
  });

  it("separates overlapping widgets and keeps them on screen", () => {
    const result = normalizeArrangement([item("a", 0, 0, 3, 2), item("b", 1, 0, 3, 2), item("c", 0, 1, 2, 2)], bounds);
    expect(noOverlaps(result)).toBe(true);
    expect(insideBounds(result)).toBe(true);
  });

  it("returns entries in the caller's order, which is the stacking order", () => {
    const result = normalizeArrangement([item("z", 4, 0, 1, 1), item("a", 0, 0, 1, 1)], bounds);
    expect([...result.keys()]).toEqual(["z", "a"]);
  });
});

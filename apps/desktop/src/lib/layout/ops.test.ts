import { describe, expect, it } from "vitest";
import { widgetCatalog } from "../../overlay/catalog";
import { defaultLayoutDoc } from "../model/defaults";
import type { Placement } from "../model/types";
import {
  addWidget,
  duplicateWidget,
  footprintOf,
  moveTo,
  neighbourSize,
  nextId,
  normalizePlacements,
  patchConfig,
  removeWidget,
  resizeTo,
  type LayoutContext,
} from "./ops";
import { rectsOverlap } from "./grid";
import { rectOf } from "./ops";

const ctx: LayoutContext = { bounds: { cols: 16, rows: 9 }, collision: "push", catalog: widgetCatalog };

const work = defaultLayoutDoc("work").monitors["primary"]?.placements ?? [];

function placement(id: string, widget: string, size: string, x: number, y: number): Placement {
  return { id, widget, size, x, y, config: {} };
}

function overlapping(ps: readonly Placement[]): boolean {
  const rects = ps.map((p) => rectOf(ctx.catalog, p));
  return rects.some((a, i) => rects.some((b, j) => i !== j && rectsOverlap(a, b)));
}

describe("footprints", () => {
  it("reads the declared size, falling back to the default size for an unknown size id", () => {
    expect(footprintOf(ctx.catalog, { widget: "clock", size: "xl" })).toEqual({ w: 8, h: 4 });
    expect(footprintOf(ctx.catalog, { widget: "clock", size: "huge" })).toEqual({ w: 4, h: 2 });
  });

  it("gives a widget the catalog does not know a one-cell footprint so it still blocks space", () => {
    expect(footprintOf(ctx.catalog, { widget: "from-the-future", size: "m" })).toEqual({ w: 1, h: 1 });
  });
});

describe("the built-in profiles", () => {
  it("all use only widgets and sizes the catalog declares", () => {
    for (const id of ["work", "focus", "minimal"]) {
      const placements = defaultLayoutDoc(id).monitors["primary"]?.placements ?? [];
      expect(placements.length).toBeGreaterThan(0);
      for (const p of placements) {
        const meta = ctx.catalog.get(p.widget);
        expect(meta, `${id}/${p.id} kind`).toBeDefined();
        expect(meta?.sizes.map((s) => s.id), `${id}/${p.id} size`).toContain(p.size);
      }
    }
  });

  it("have no overlaps and fit a 16 by 9 grid unchanged", () => {
    for (const id of ["work", "focus", "minimal"]) {
      const placements = defaultLayoutDoc(id).monitors["primary"]?.placements ?? [];
      expect(overlapping(placements)).toBe(false);
      expect(normalizePlacements(placements, ctx)).toBe(placements);
    }
  });
});

describe("moveTo", () => {
  it("moves a widget to a free cell", () => {
    const next = moveTo(work, "date-1", { x: 12, y: 0 }, ctx);
    expect(next?.find((p) => p.id === "date-1")).toMatchObject({ x: 12, y: 0 });
    expect(next?.filter((p) => p.id !== "date-1")).toEqual(work.filter((p) => p.id !== "date-1"));
  });

  it("never lets a drop leave the grid", () => {
    const next = moveTo(work, "date-1", { x: 99, y: 99 }, ctx);
    expect(next?.find((p) => p.id === "date-1")).toMatchObject({ x: 14, y: 7 });
  });

  it("pushes a neighbour instead of overlapping it", () => {
    const next = moveTo(work, "system-1", { x: 10, y: 2 }, ctx);
    expect(next).not.toBeNull();
    expect(overlapping(next ?? [])).toBe(false);
    expect(next?.find((p) => p.id === "system-1")).toMatchObject({ x: 10, y: 2 });
    expect(next?.find((p) => p.id === "system-2")).not.toMatchObject({ x: 10, y: 2 });
  });

  it("swaps two widgets when the mode is swap", () => {
    const swapCtx: LayoutContext = { ...ctx, collision: "swap" };
    const next = moveTo(work, "system-1", { x: 10, y: 2 }, swapCtx);
    expect(next?.find((p) => p.id === "system-1")).toMatchObject({ x: 10, y: 2 });
    expect(next?.find((p) => p.id === "system-2")).toMatchObject({ x: 8, y: 2 });
  });

  it("returns null for an unknown widget and does not mutate the input", () => {
    const before = JSON.stringify(work);
    expect(moveTo(work, "nope", { x: 0, y: 0 }, ctx)).toBeNull();
    moveTo(work, "system-1", { x: 10, y: 2 }, ctx);
    expect(JSON.stringify(work)).toBe(before);
  });
});

describe("resizeTo", () => {
  const clockOnly = [placement("clock-1", "clock", "m", 0, 0), placement("cal-1", "calendar", "m", 0, 2)];

  it("changes to a declared size", () => {
    const next = resizeTo([placement("clock-1", "clock", "m", 0, 0)], "clock-1", "l", ctx);
    expect(next?.[0]).toMatchObject({ size: "l", x: 0, y: 0 });
  });

  it("pushes neighbours out of the way when it grows", () => {
    const next = resizeTo(clockOnly, "clock-1", "l", ctx);
    expect(next).not.toBeNull();
    expect(overlapping(next ?? [])).toBe(false);
    expect(next?.find((p) => p.id === "clock-1")?.size).toBe("l");
  });

  it("keeps a growing widget on screen by shifting it", () => {
    const next = resizeTo([placement("clock-1", "clock", "m", 12, 0)], "clock-1", "xl", ctx);
    expect(next?.[0]).toMatchObject({ size: "xl", x: 8 });
  });

  it("rejects sizes the widget does not declare", () => {
    expect(resizeTo(clockOnly, "clock-1", "xxl", ctx)).toBeNull();
    expect(resizeTo(clockOnly, "cal-1", "xl", ctx)).toBeNull();
  });

  it("is a no-op for the current size", () => {
    expect(resizeTo(clockOnly, "clock-1", "m", ctx)).toBe(clockOnly);
  });

  it("steps through sizes from smallest to largest", () => {
    expect(neighbourSize(clockOnly, "clock-1", 1, ctx)).toBe("l");
    expect(neighbourSize(clockOnly, "clock-1", -1, ctx)).toBeNull();
    expect(neighbourSize([placement("clock-1", "clock", "xl", 0, 0)], "clock-1", 1, ctx)).toBeNull();
    expect(neighbourSize([placement("w-1", "world-clocks", "m", 0, 0)], "w-1", 1, ctx)).toBeNull();
  });
});

describe("add, duplicate, remove, configure", () => {
  it("adds a widget at the first free spot with its default size and config", () => {
    const added = addWidget([], "clock", undefined, ctx);
    expect(added?.placements).toEqual([
      { id: "clock-1", widget: "clock", size: "m", x: 0, y: 0, config: {} },
    ]);
    const second = addWidget(added?.placements ?? [], "clock", "xl", ctx);
    expect(second?.id).toBe("clock-2");
    expect(second?.placements[1]).toMatchObject({ size: "xl", x: 4, y: 0 });
  });

  it("adds a widget as close to the pointed cell as there is room for", () => {
    const at = addWidget([], "clock", undefined, ctx, { x: 6, y: 3 });
    expect(at?.placements[0]).toMatchObject({ x: 6, y: 3 });
    const blocked = addWidget(at?.placements ?? [], "clock", undefined, ctx, { x: 6, y: 3 });
    const placed = blocked?.placements[1];
    expect(placed).toBeDefined();
    expect(overlapping(blocked?.placements ?? [])).toBe(false);
  });

  it("reports no room instead of overlapping", () => {
    const full = [placement("c-1", "clock", "l", 0, 0), placement("c-2", "clock", "l", 4, 0), placement("c-3", "clock", "l", 0, 4), placement("c-4", "clock", "l", 4, 4)];
    const tiny: LayoutContext = { ...ctx, bounds: { cols: 8, rows: 8 } };
    expect(addWidget(full, "calendar", undefined, tiny)).toBeNull();
  });

  it("refuses to add an unknown widget kind", () => {
    expect(addWidget([], "teapot", undefined, ctx)).toBeNull();
  });

  it("duplicates with the same config and a fresh id, in free space", () => {
    const original = [{ ...placement("clock-1", "clock", "m", 0, 0), config: { hour24: false } }];
    const copy = duplicateWidget(original, "clock-1", ctx);
    expect(copy?.id).toBe("clock-2");
    expect(copy?.placements[1]?.config).toEqual({ hour24: false });
    expect(overlapping(copy?.placements ?? [])).toBe(false);
  });

  it("generates the smallest unused id", () => {
    expect(nextId("clock", new Set(["clock-1", "clock-3"]))).toBe("clock-2");
  });

  it("removes and patches without touching other widgets", () => {
    expect(removeWidget(work, "system-1")).toHaveLength(work.length - 1);
    expect(removeWidget(work, "missing")).toBe(work);
    const patched = patchConfig(work, "clock-1", { hour24: false });
    expect(patched.find((p) => p.id === "clock-1")?.config).toMatchObject({ hour24: false });
    expect(patched.find((p) => p.id === "system-1")).toBe(work.find((p) => p.id === "system-1"));
  });
});

describe("normalizePlacements", () => {
  it("resolves an unknown size to the default size so what is drawn matches what is stored", () => {
    const next = normalizePlacements([placement("clock-1", "clock", "gigantic", 0, 0)], ctx);
    expect(next[0]?.size).toBe("m");
  });

  it("returns the same array when the layout is already valid", () => {
    expect(normalizePlacements(work, ctx)).toBe(work);
  });

  it("fits a layout made on a big display onto a small one without overlaps", () => {
    const big = [placement("a", "calendar", "m", 20, 12), placement("b", "calendar", "m", 22, 12)];
    const next = normalizePlacements(big, { ...ctx, bounds: { cols: 8, rows: 5 } });
    expect(overlapping(next)).toBe(false);
    for (const p of next) {
      const r = rectOf(ctx.catalog, p);
      expect(r.x + r.w).toBeLessThanOrEqual(8);
      expect(r.y + r.h).toBeLessThanOrEqual(5);
    }
  });
});

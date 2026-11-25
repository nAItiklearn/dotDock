/**
 * The shipped home-screen default (B5, `docs/BUGS_1_0_3.md`). Users reported widgets "in random places":
 * the default was expressed in the owner's 1920 x 1080 cells, with a 1/32-cell jitter, so on a shorter
 * viewport two widgets fell past the last row, `normalizePlacements` clamped them into an occupied cell
 * and then relocated them to the "nearest free spot" - the scatter.
 *
 * These tests pin the arrangement itself (two columns, in the owner's reading order), pin that every
 * position is a whole cell, and check the default lands untouched on every resolution and scaling we
 * support. The grid cell is a fixed CSS pixel token, so a layout anchored at the origin keeps the same
 * arrangement at any size; what changes with the viewport is only how many cells exist.
 */
import { describe, expect, it } from "vitest";
import { widgetCatalog } from "../../overlay/catalog";
import { boundsFor, type GridMetrics } from "../layout/grid";
import { normalizePlacements, rectOf, type LayoutContext } from "../layout/ops";
import { DEFAULT_SETTINGS, defaultLayoutDoc, MIN_SUPPORTED_BOUNDS } from "./defaults";
import { PRIMARY_MONITOR, type Bounds, type Placement } from "./types";

/** The stylesheet's `--cell` token with the shipped spacing: what `useGridMetrics` reports on a fresh install. */
const METRICS: GridMetrics = { cell: 76, gap: DEFAULT_SETTINGS.layout.gap, edge: DEFAULT_SETTINGS.layout.edgeMargin };

/** Physical panel sizes we promise the default on, with the Windows scalings offered for them. */
const SCREENS = [
  { name: "1366x768 laptop", width: 1366, height: 768 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "2560x1440", width: 2560, height: 1440 },
] as const;
const SCALINGS = [1, 1.25, 1.5] as const;

function work(): readonly Placement[] {
  return defaultLayoutDoc("work").monitors[PRIMARY_MONITOR]?.placements ?? [];
}

function context(bounds: Bounds): LayoutContext {
  return { bounds, collision: DEFAULT_SETTINGS.layout.collision, catalog: widgetCatalog };
}

/** A webview gets the panel divided by the scaling: a 150 % 1080p screen is a 1280 x 720 CSS viewport. */
function viewportBounds(width: number, height: number, scale: number): Bounds {
  return boundsFor(width / scale, height / scale, METRICS);
}

const LEFT_COLUMN = ["clock-1", "music-1", "photo-1"] as const;
const RIGHT_COLUMN = ["date-1", "battery-1", "timer-1", "system-1"] as const;

/** Widgets that ended up on the wrong side of the two columns, named so a failure reads itself. */
function columnsCrossed(placed: readonly Placement[]): string[] {
  const left: ReadonlySet<string> = new Set<string>(LEFT_COLUMN);
  const boundary = Math.min(...RIGHT_COLUMN.map((id) => work().find((p) => p.id === id)?.x ?? 0));
  return placed
    .filter((p) => (left.has(p.id) ? p.x >= boundary : p.x < boundary))
    .map((p) => `${p.id} at ${p.x},${p.y}`);
}

describe("the shipped Work layout is the owner's two columns", () => {
  it("is the left column clock, now-playing, photo and the right column date, battery, timer, RAM", () => {
    expect(work().map((p) => [p.id, p.widget, p.size, p.x, p.y])).toEqual([
      ["clock-1", "clock", "m", 0, 0],
      ["music-1", "music", "m", 0, 2],
      ["photo-1", "photo", "s", 0, 4],
      ["date-1", "date", "m", 4, 0],
      ["battery-1", "battery", "m", 4, 1],
      ["timer-1", "timer", "s", 4, 3],
      ["system-1", "system", "m", 4, 5],
    ]);
  });

  it("drops the fun fact the owner's screenshot does not show", () => {
    expect(work().map((p) => p.widget)).not.toContain("fun-fact");
  });

  it("places every widget on a whole cell, with no fraction of a cell left in", () => {
    const fractional = work().filter((p) => !Number.isInteger(p.x) || !Number.isInteger(p.y));
    expect(fractional.map((p) => `${p.id} at ${p.x},${p.y}`)).toEqual([]);
  });

  it("stacks each column top to bottom with no gap and no overlap", () => {
    for (const column of [LEFT_COLUMN, RIGHT_COLUMN] as readonly (readonly string[])[]) {
      const rects = column.map((id) => {
        const p = work().find((q) => q.id === id);
        if (!p) throw new Error(`${id} is missing from the default`);
        return rectOf(widgetCatalog, p);
      });
      const left = rects.map((r) => r.x);
      expect(new Set(left).size, `${column.join(", ")} share one left edge`).toBe(1);
      rects.slice(1).forEach((r, i) => {
        const above = rects[i];
        if (!above) throw new Error("unreachable");
        expect(r.y, `${column[i + 1]} sits directly under ${column[i]}`).toBe(above.y + above.h);
      });
    }
  });

  it("puts the right column clear of the widest widget in the left one", () => {
    const widest = Math.max(...LEFT_COLUMN.map((id) => {
      const p = work().find((q) => q.id === id);
      return p ? rectOf(widgetCatalog, p).x + rectOf(widgetCatalog, p).w : 0;
    }));
    const rightEdges = RIGHT_COLUMN.map((id) => {
      const p = work().find((q) => q.id === id);
      return p ? p.x : -1;
    });
    expect(Math.min(...rightEdges)).toBeGreaterThanOrEqual(widest);
  });
});

describe("the shipped Work layout fits the screens we support", () => {
  it("fits the smallest viewport we promise it on", () => {
    const rects = work().map((p) => rectOf(widgetCatalog, p));
    expect(Math.max(...rects.map((r) => r.x + r.w))).toBeLessThanOrEqual(MIN_SUPPORTED_BOUNDS.cols);
    expect(Math.max(...rects.map((r) => r.y + r.h))).toBeLessThanOrEqual(MIN_SUPPORTED_BOUNDS.rows);
  });

  const combinations = SCREENS.flatMap((s) => SCALINGS.map((scale) => ({ ...s, scale })));
  const fits = ({ width, height, scale }: (typeof combinations)[number]): boolean => {
    const b = viewportBounds(width, height, scale);
    return b.cols >= MIN_SUPPORTED_BOUNDS.cols && b.rows >= MIN_SUPPORTED_BOUNDS.rows;
  };

  it("fits every screen except a 1366 x 768 panel scaled past 100 %", () => {
    // The combinations the default is promised on, so a change to the layout or to the cell token that
    // quietly drops one of them fails here rather than on a user's desktop.
    expect(combinations.filter((c) => !fits(c)).map((c) => `${c.name} at ${c.scale}x`)).toEqual([
      "1366x768 laptop at 1.25x",
      "1366x768 laptop at 1.5x",
    ]);
  });

  it.each(combinations.filter(fits))("lands exactly as shipped on a $name at $scale x scaling", (combination) => {
    const bounds = viewportBounds(combination.width, combination.height, combination.scale);
    const shipped = work();
    const moved = normalizePlacements(shipped, context(bounds))
      .filter((p, i) => p.x !== shipped[i]?.x || p.y !== shipped[i]?.y)
      .map((p) => `${p.id} moved to ${p.x},${p.y}`);
    expect(moved, `${bounds.cols} x ${bounds.rows} cells`).toEqual([]);
  });

  // Expected to fail until `normalizeArrangement` degrades predictably: a widget that cannot fit is sent
  // to the "nearest free spot", which can be the other column. Below the supported bounds the arrangement
  // should lose its tail, not swap sides. Turn these back into `it` with that fix.
  it.fails("keeps its two columns on a viewport too small to hold it (B5: the nearest-free-spot scatter)", () => {
    for (const combination of combinations.filter((c) => !fits(c))) {
      const bounds = viewportBounds(combination.width, combination.height, combination.scale);
      expect(columnsCrossed(normalizePlacements(work(), context(bounds))), `${bounds.cols} x ${bounds.rows}`).toEqual([]);
    }
    for (let rows = 2; rows < MIN_SUPPORTED_BOUNDS.rows; rows++) {
      const placed = normalizePlacements(work(), context({ cols: MIN_SUPPORTED_BOUNDS.cols, rows }));
      expect(columnsCrossed(placed), `${rows} rows`).toEqual([]);
    }
  });
});

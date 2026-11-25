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
import { boundsFor, freeSpotInColumn, type GridMetrics } from "../layout/grid";
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

  /** Widgets that left their column while that column still had room for them: the avoidable scatter. */
  function avoidablyMoved(placed: readonly Placement[], bounds: Bounds): string[] {
    return placed.filter((p) => {
      const home = work().find((q) => q.id === p.id);
      if (!home || p.x === home.x) return false;
      const others = placed.filter((q) => q.id !== p.id).map((q) => rectOf(widgetCatalog, q));
      const { w, h } = rectOf(widgetCatalog, p);
      return freeSpotInColumn(others, w, h, bounds, { x: home.x, y: home.y }) !== null;
    }).map((p) => `${p.id} left column ${work().find((q) => q.id === p.id)?.x} for ${p.x}`);
  }

  it.each([
    ...combinations.filter((c) => !fits(c)).map((c) => ({
      label: `a ${c.name} at ${c.scale}x scaling`,
      bounds: viewportBounds(c.width, c.height, c.scale),
    })),
    ...Array.from({ length: MIN_SUPPORTED_BOUNDS.rows - 2 }, (_, i) => ({
      label: `${i + 2} rows`,
      bounds: { cols: MIN_SUPPORTED_BOUNDS.cols, rows: i + 2 },
    })),
  ])("gives up its tail rather than scrambling on $label, where it cannot fit", ({ bounds }) => {
    const placed = normalizePlacements(work(), context(bounds));
    // Nothing invented, nothing lost: the user can still reach every widget they were given.
    expect(placed.map((p) => p.id).sort()).toEqual(work().map((p) => p.id).sort());
    // Whatever has to give, a widget only leaves its column when that column has no room left for it.
    expect(avoidablyMoved(placed, bounds)).toEqual([]);
  });
});

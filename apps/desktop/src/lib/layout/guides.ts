import type { Rect } from "../model/types";

/**
 * An alignment guide: a line along which the moving widget lines up with another one.
 * Everything snaps to cells, so only like edges can coincide (start with start, end with end,
 * centre with centre); a start against an end is always one gap apart and is not alignment.
 */
export interface Guide {
  /** "x" is a vertical line at a column position; "y" is a horizontal line at a row position. */
  readonly axis: "x" | "y";
  readonly edge: "start" | "center" | "end";
  /** Cell coordinate of the aligned edge. Centres can be half-cells. */
  readonly at: number;
  /** Extent of the line along the other axis, in cells. */
  readonly from: number;
  readonly to: number;
}

interface Probe {
  readonly edge: Guide["edge"];
  readonly value: (r: Rect) => number;
}

const COLUMN_PROBES: readonly Probe[] = [
  { edge: "start", value: (r) => r.x },
  { edge: "center", value: (r) => r.x + r.w / 2 },
  { edge: "end", value: (r) => r.x + r.w },
];
const ROW_PROBES: readonly Probe[] = [
  { edge: "start", value: (r) => r.y },
  { edge: "center", value: (r) => r.y + r.h / 2 },
  { edge: "end", value: (r) => r.y + r.h },
];

/** Guides between `moving` and every other rectangle, merged per line. */
export function computeGuides(moving: Rect, others: readonly Rect[]): readonly Guide[] {
  const merged = new Map<string, Guide>();
  const scan = (axis: Guide["axis"], probes: readonly Probe[]): void => {
    for (const other of others) {
      for (const probe of probes) {
        const at = probe.value(moving);
        if (at !== probe.value(other)) continue;
        const [lo, hi] =
          axis === "x"
            ? [Math.min(moving.y, other.y), Math.max(moving.y + moving.h, other.y + other.h)]
            : [Math.min(moving.x, other.x), Math.max(moving.x + moving.w, other.x + other.w)];
        const key = `${axis}:${probe.edge}:${at}`;
        const existing = merged.get(key);
        merged.set(
          key,
          existing
            ? { ...existing, from: Math.min(existing.from, lo), to: Math.max(existing.to, hi) }
            : { axis, edge: probe.edge, at, from: lo, to: hi },
        );
      }
    }
  };
  scan("x", COLUMN_PROBES);
  scan("y", ROW_PROBES);
  return [...merged.values()];
}

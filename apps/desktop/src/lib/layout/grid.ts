import type { Bounds, Cell, Rect } from "../model/types";

/** Pixel geometry of the cell grid; mirrors --cell, --gap and --edge in tokens.css. */
export interface GridMetrics {
  readonly cell: number;
  readonly gap: number;
  readonly edge: number;
}

export const pitch = (m: GridMetrics): number => m.cell + m.gap;

/** Pixel size of `n` cells including the gaps between them. */
export function spanPx(n: number, m: GridMetrics): number {
  return n * m.cell + Math.max(0, n - 1) * m.gap;
}

/** Left or top pixel of a cell coordinate. */
export function cellStartPx(cell: number, m: GridMetrics): number {
  return m.edge + cell * pitch(m);
}

export interface PxRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function rectToPx(rect: Rect, m: GridMetrics): PxRect {
  return {
    left: cellStartPx(rect.x, m),
    top: cellStartPx(rect.y, m),
    width: spanPx(rect.w, m),
    height: spanPx(rect.h, m),
  };
}

/** Nearest cell coordinate for a pixel offset measured from the cell origin (the top-left of cell 0). */
export function roundToCell(deltaPx: number, m: GridMetrics): number {
  return Math.round(deltaPx / pitch(m));
}

/** How many cells fit between the safe margins of a viewport. At least one, so layouts never collapse. */
export function boundsFor(viewportWidth: number, viewportHeight: number, m: GridMetrics): Bounds {
  const fit = (extent: number): number => Math.max(1, Math.floor((extent - 2 * m.edge + m.gap) / pitch(m)));
  return { cols: fit(viewportWidth), rows: fit(viewportHeight) };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function fitsBounds(r: Rect, bounds: Bounds): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= bounds.cols && r.y + r.h <= bounds.rows;
}

/** Pulls a rectangle inside the bounds. A rectangle larger than the bounds is pinned to the origin. */
export function clampRect(r: Rect, bounds: Bounds): Rect {
  const x = Math.max(0, Math.min(r.x, bounds.cols - r.w));
  const y = Math.max(0, Math.min(r.y, bounds.rows - r.h));
  return x === r.x && y === r.y ? r : { ...r, x, y };
}

export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * Closest cell to `around` where a w×h rectangle fits without touching `occupied`.
 * Ties go to the earlier row, then the earlier column, so results are stable.
 */
export function nearestFreeSpot(
  occupied: readonly Rect[],
  w: number,
  h: number,
  bounds: Bounds,
  around: Cell = { x: 0, y: 0 },
): Cell | null {
  let best: Cell | null = null;
  let bestDistance = Infinity;
  for (let y = 0; y + h <= bounds.rows; y++) {
    for (let x = 0; x + w <= bounds.cols; x++) {
      const distance = Math.abs(x - around.x) + Math.abs(y - around.y);
      if (distance >= bestDistance) continue;
      const candidate: Rect = { x, y, w, h };
      if (occupied.some((o) => rectsOverlap(o, candidate))) continue;
      best = { x, y };
      bestDistance = distance;
    }
  }
  return best;
}

/** First free spot in reading order (left to right, top to bottom). */
export function firstFreeSpot(occupied: readonly Rect[], w: number, h: number, bounds: Bounds): Cell | null {
  for (let y = 0; y + h <= bounds.rows; y++) {
    for (let x = 0; x + w <= bounds.cols; x++) {
      const candidate: Rect = { x, y, w, h };
      if (!occupied.some((o) => rectsOverlap(o, candidate))) return { x, y };
    }
  }
  return null;
}

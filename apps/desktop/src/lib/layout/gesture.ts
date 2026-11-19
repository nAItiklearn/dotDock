import type { SizeSpec } from "../../widgets/sizes";
import type { Cell } from "../model/types";
import { roundToCell, spanPx, type GridMetrics } from "./grid";

/** Pointer travel (px) before a press becomes a drag; below it the press is just a click that selects. */
export const DRAG_THRESHOLD_PX = 4;

export function passedDragThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

/** The cell a widget snaps to when its pointer has travelled (dx, dy) pixels from where it started. */
export function dragTarget(origin: Cell, dx: number, dy: number, metrics: GridMetrics): Cell {
  return { x: origin.x + roundToCell(dx, metrics), y: origin.y + roundToCell(dy, metrics) };
}

/**
 * Declared sizes ordered by how close they are to the pointer's current corner position, nearest
 * first. The caller walks the list and takes the first size that fits, so a resize never lands
 * on an impossible size just because it is the closest.
 */
export function sizesByProximity(
  sizes: readonly SizeSpec[],
  desiredWidthPx: number,
  desiredHeightPx: number,
  metrics: GridMetrics,
): readonly SizeSpec[] {
  const distance = (s: SizeSpec): number =>
    Math.abs(spanPx(s.w, metrics) - desiredWidthPx) + Math.abs(spanPx(s.h, metrics) - desiredHeightPx);
  return [...sizes].sort((a, b) => distance(a) - distance(b));
}

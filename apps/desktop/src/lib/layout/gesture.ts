import type { SizeSpec } from "../../widgets/sizes";
import type { Bounds, Cell } from "../model/types";
import { pitch, roundToCell, spanPx, type GridMetrics } from "./grid";

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

/**
 * Direct editing on the home screen, outside edit mode. A widget is still a thing to click there, so a
 * gesture needs clear intent: a drag a little longer than a click wobble, or a still press held briefly.
 */
export const DIRECT_DRAG_PX = 8;
/** How long a still press must last to lift the widget (and enter edit mode). */
export const HOLD_MS = 320;
/** Movement allowed while holding; more than this before the hold completes means it was not a hold. */
export const HOLD_SLOP_PX = 6;

export type PressIntent = "pending" | "drag" | "hold" | "none";

/**
 * What a press on a widget has become, from how long it has lasted and how far the pointer travelled.
 * "none" means the press wandered too far to be a hold but not far enough to be a drag; it stays a
 * plain press until it crosses the drag distance or is released (a click, which edits nothing).
 */
export function classifyPress(elapsedMs: number, dx: number, dy: number): PressIntent {
  const distance = Math.hypot(dx, dy);
  if (distance >= DIRECT_DRAG_PX) return "drag";
  if (distance > HOLD_SLOP_PX) return "none";
  return elapsedMs >= HOLD_MS ? "hold" : "pending";
}

/** The grid cell under a viewport point, clamped to the grid; used to add a widget where the user pointed. */
export function cellAtPoint(px: number, py: number, metrics: GridMetrics, bounds: Bounds): Cell {
  const clamp = (v: number, max: number): number => Math.min(Math.max(v, 0), Math.max(max - 1, 0));
  return {
    x: clamp(Math.floor((px - metrics.edge) / pitch(metrics)), bounds.cols),
    y: clamp(Math.floor((py - metrics.edge) / pitch(metrics)), bounds.rows),
  };
}

/** The top-left cell that puts the pointed cell in the middle of a w x h widget, so it lands under the pointer. */
export function centredOrigin(at: Cell, w: number, h: number): Cell {
  return { x: Math.max(0, at.x - Math.floor((w - 1) / 2)), y: Math.max(0, at.y - Math.floor((h - 1) / 2)) };
}

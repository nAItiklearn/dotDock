import type { Rect, Regions } from "./protocol";
import type { Mode } from "./geometry";

/** Margin around the island that still counts as "on it", so the edge never flickers. */
export const HIT_MARGIN = 6;
/** Wider margin for the aside hover footprint: the island only returns once the cursor is clearly gone. */
export const HOVER_MARGIN = 16;

export interface RegionInput {
  /** Where the plate sits when at rest, in window CSS px. Layout position, ignoring any slide transform. */
  readonly rest: Rect;
  readonly mode: Mode;
  readonly moveAside: boolean;
  readonly aside: boolean;
  /** Anything else on screen that takes clicks while the island rests, such as the connect offer. */
  readonly extra?: Rect | null;
}

const isActive = (mode: Mode): boolean => mode === "island";

/**
 * What the core needs to know to make the window click-through everywhere except the island.
 * The hover footprint always covers the resting position (down from the screen edge), also while the
 * island has slid away, so moving the cursor back out is what brings it back.
 */
export function computeRegions({ rest, mode, moveAside, aside, extra = null }: RegionInput): Regions {
  const pad = (r: Rect): Rect => ({ x: r.x - HIT_MARGIN, y: r.y - HIT_MARGIN, w: r.w + 2 * HIT_MARGIN, h: r.h + 2 * HIT_MARGIN });
  if (!isActive(mode)) return { interactive: extra ? [pad(extra)] : [], hover: null };
  const interactive: Rect[] = aside ? [] : [pad(rest)];
  const hover: Rect | null = moveAside
    ? { x: rest.x - HOVER_MARGIN, y: 0, w: rest.w + 2 * HOVER_MARGIN, h: rest.y + rest.h + HOVER_MARGIN }
    : null;
  return { interactive, hover };
}

export function sameRegions(a: Regions, b: Regions): boolean {
  const same = (x: Rect, y: Rect): boolean => x.x === y.x && x.y === y.y && x.w === y.w && x.h === y.h;
  if (a.interactive.length !== b.interactive.length) return false;
  if (!a.interactive.every((rect, i) => same(rect, b.interactive[i] as Rect))) return false;
  if (a.hover === null || b.hover === null) return a.hover === b.hover;
  return same(a.hover, b.hover);
}

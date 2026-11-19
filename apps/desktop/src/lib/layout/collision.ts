import type { Bounds, CollisionMode, Rect } from "../model/types";
import { clampRect, fitsBounds, nearestFreeSpot, rectsOverlap } from "./grid";

export interface Item extends Rect {
  readonly id: string;
}

export type Arrangement = ReadonlyMap<string, Rect>;

/** The four places `r` could go to clear `by`, in tie-break order: down, right, up, left. */
function pushedPositions(r: Rect, by: Rect): readonly { readonly rect: Rect; readonly distance: number }[] {
  return [
    { rect: { ...r, y: by.y + by.h }, distance: by.y + by.h - r.y },
    { rect: { ...r, x: by.x + by.w }, distance: by.x + by.w - r.x },
    { rect: { ...r, y: by.y - r.h }, distance: r.y + r.h - by.y },
    { rect: { ...r, x: by.x - r.w }, distance: r.x + r.w - by.x },
  ];
}

/** Smallest shove that clears `r` from `by`, staying inside the bounds and off the immovable rectangle. */
function pushAway(r: Rect, by: Rect, fixed: Rect, bounds: Bounds): Rect | null {
  let best: Rect | null = null;
  let bestDistance = Infinity;
  for (const { rect, distance } of pushedPositions(r, by)) {
    if (distance >= bestDistance) continue;
    if (!fitsBounds(rect, bounds) || rectsOverlap(rect, fixed)) continue;
    best = rect;
    bestDistance = distance;
  }
  return best;
}

function toMap(items: readonly Item[]): Map<string, Rect> {
  return new Map(items.map((i) => [i.id, { x: i.x, y: i.y, w: i.w, h: i.h }] as const));
}

/**
 * Places `movedId` at `target` and shoves anything it lands on out of the way, cascading.
 * The moved rectangle is immovable. Returns null when the neighbours have nowhere to go.
 */
export function resolvePush(items: readonly Item[], movedId: string, target: Rect, bounds: Bounds): Arrangement | null {
  const fixed = clampRect(target, bounds);
  if (!fitsBounds(fixed, bounds)) return null;
  const rects = toMap(items);
  rects.set(movedId, fixed);
  const queue = [movedId];
  const maxSteps = items.length * 8 + 32;
  for (let steps = 0; queue.length > 0; steps++) {
    if (steps > maxSteps) return null;
    const moverId = queue.shift();
    const mover = moverId === undefined ? undefined : rects.get(moverId);
    if (moverId === undefined || !mover) continue;
    for (const [id, r] of rects) {
      if (id === movedId || id === moverId || !rectsOverlap(mover, r)) continue;
      const next = pushAway(r, mover, fixed, bounds);
      if (!next) return null;
      rects.set(id, next);
      queue.push(id);
    }
  }
  return rects;
}

/**
 * Swap: the moved widget takes the place under it and that widget takes the moved one's old place.
 * Only valid when exactly one widget is hit and it fits there; otherwise the caller falls back to push.
 */
export function resolveSwap(items: readonly Item[], movedId: string, target: Rect, bounds: Bounds): Arrangement | null {
  const rects = toMap(items);
  const origin = rects.get(movedId);
  if (!origin) return null;
  const dest = clampRect(target, bounds);
  const hit = [...rects].filter(([id, r]) => id !== movedId && rectsOverlap(dest, r));
  if (hit.length === 0) {
    rects.set(movedId, dest);
    return rects;
  }
  const [only] = hit;
  if (hit.length !== 1 || !only) return null;
  const [otherId, other] = only;
  const home: Rect = { x: origin.x, y: origin.y, w: other.w, h: other.h };
  if (!fitsBounds(home, bounds) || rectsOverlap(home, dest)) return null;
  const blocked = [...rects].some(([id, r]) => id !== movedId && id !== otherId && rectsOverlap(home, r));
  if (blocked) return null;
  rects.set(movedId, dest);
  rects.set(otherId, home);
  return rects;
}

/** Moves one widget according to the collision mode. Swap quietly falls back to push when it cannot swap. */
export function resolveMove(
  items: readonly Item[],
  movedId: string,
  target: Rect,
  mode: CollisionMode,
  bounds: Bounds,
): Arrangement | null {
  if (mode === "swap") {
    const swapped = resolveSwap(items, movedId, target, bounds);
    if (swapped) return swapped;
  }
  return resolvePush(items, movedId, target, bounds);
}

/**
 * Makes an arbitrary set of rectangles valid for these bounds: inside the edges and overlap-free.
 * Items keep their position whenever possible; the rest move to the nearest free spot.
 * Returns the very same map contents when nothing needed to change.
 */
export function normalizeArrangement(items: readonly Item[], bounds: Bounds): Arrangement {
  const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: Rect[] = [];
  const result = new Map<string, Rect>();
  for (const item of ordered) {
    const wanted = clampRect({ x: item.x, y: item.y, w: item.w, h: item.h }, bounds);
    let final: Rect = wanted;
    if (placed.some((p) => rectsOverlap(p, wanted))) {
      const spot = nearestFreeSpot(placed, wanted.w, wanted.h, bounds, wanted);
      if (spot) final = { ...wanted, x: spot.x, y: spot.y };
    }
    placed.push(final);
    result.set(item.id, final);
  }
  // Preserve the caller's order (it is the stacking order).
  return new Map(items.map((i) => [i.id, result.get(i.id) ?? i] as const));
}

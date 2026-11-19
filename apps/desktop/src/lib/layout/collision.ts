import type { Bounds, CollisionMode, Rect } from "../model/types";
import { clampRect, fitsBounds, nearestFreeSpot, rectsOverlap } from "./grid";

export interface Item extends Rect {
  readonly id: string;
}

export type Arrangement = ReadonlyMap<string, Rect>;

/** The four places `r` could go to clear `by`, in tie-break order: down, right, up, left. */
function pushedPositions(r: Rect, by: Rect): readonly Rect[] {
  return [
    { ...r, y: by.y + by.h },
    { ...r, x: by.x + by.w },
    { ...r, y: by.y - r.h },
    { ...r, x: by.x - r.w },
  ];
}

function toMap(items: readonly Item[]): Map<string, Rect> {
  return new Map(items.map((i) => [i.id, { x: i.x, y: i.y, w: i.w, h: i.h }] as const));
}

/** The first two rectangles that overlap, in the map's order, or null when the arrangement is clean. */
function firstClash(rects: ReadonlyMap<string, Rect>): readonly [string, string] | null {
  const entries = [...rects];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (a && b && rectsOverlap(a[1], b[1])) return [a[0], b[0]];
    }
  }
  return null;
}

/** A neighbour never moves further than this many widgets away from the drop; beyond it the drop is refused. */
const MAX_PUSHED_WIDGETS = 3;
/** Search budget. Layouts hold a handful of widgets, so this is only ever a guard against pathological input. */
const MAX_SEARCH_NODES = 600;

interface SearchState {
  readonly rects: ReadonlyMap<string, Rect>;
  readonly cost: number;
  readonly pushed: number;
  readonly order: number;
}

/** How far, and how many, neighbours have been moved from where they started. */
function displacement(
  rects: ReadonlyMap<string, Rect>,
  origin: ReadonlyMap<string, Rect>,
  movedId: string,
): { readonly cost: number; readonly pushed: number; readonly signature: string } {
  let cost = 0;
  let pushed = 0;
  const signature: string[] = [];
  for (const [id, r] of rects) {
    const o = origin.get(id);
    if (id === movedId || !o || (o.x === r.x && o.y === r.y)) continue;
    cost += Math.abs(r.x - o.x) + Math.abs(r.y - o.y);
    pushed++;
    signature.push(`${id}:${r.x},${r.y}`);
  }
  return { cost, pushed, signature: signature.sort().join("|") };
}

/**
 * Places `movedId` at `target` and moves whatever it lands on out of the way.
 *
 * The moved rectangle is immovable. Among all ways to clear the clashes this finds the one that
 * moves neighbours the least in total (best-first search), so a drop nudges the widgets beside it
 * rather than rearranging the desktop. At most {@link MAX_PUSHED_WIDGETS} neighbours move; if the
 * neighbourhood is too crowded for that, the drop is refused (null).
 */
export function resolvePush(items: readonly Item[], movedId: string, target: Rect, bounds: Bounds): Arrangement | null {
  const fixed = clampRect(target, bounds);
  if (!fitsBounds(fixed, bounds)) return null;
  const origin = toMap(items);
  const start = new Map(origin);
  start.set(movedId, fixed);

  const open: SearchState[] = [{ rects: start, cost: 0, pushed: 0, order: 0 }];
  const seen = new Set<string>();
  let order = 1;
  for (let nodes = 0; open.length > 0 && nodes < MAX_SEARCH_NODES; nodes++) {
    open.sort((a, b) => a.cost - b.cost || a.order - b.order);
    const state = open.shift();
    if (!state) break;
    const clash = firstClash(state.rects);
    if (!clash) return state.rects;
    // Either member of the clash may be the one to give way, except the dropped widget.
    for (const id of clash) {
      if (id === movedId) continue;
      const other = state.rects.get(id === clash[0] ? clash[1] : clash[0]);
      const current = state.rects.get(id);
      if (!other || !current) continue;
      for (const rect of pushedPositions(current, other)) {
        if (!fitsBounds(rect, bounds) || rectsOverlap(rect, fixed)) continue;
        const rects = new Map(state.rects);
        rects.set(id, rect);
        const { cost, pushed, signature } = displacement(rects, origin, movedId);
        if (pushed > MAX_PUSHED_WIDGETS || seen.has(signature)) continue;
        seen.add(signature);
        open.push({ rects, cost, pushed, order: order++ });
      }
    }
  }
  return null;
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

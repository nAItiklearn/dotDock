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

/** A drop may move at most this many neighbours; beyond it the drop is refused rather than reshuffling the desktop. */
const MAX_PUSHED_WIDGETS = 3;
/** Search budget. Layouts hold a handful of widgets, so this only ever guards against pathological input. */
const MAX_SEARCH_NODES = 120;

interface SearchState {
  /** Only the neighbours that have been moved, by id. Everything else is where it started. */
  readonly shifted: ReadonlyMap<string, Rect>;
  /** Widgets whose overlaps still need checking; moving one puts it back on the list. */
  readonly pending: readonly string[];
  readonly cost: number;
  readonly order: number;
}

const cheaper = (a: SearchState, b: SearchState): boolean => a.cost < b.cost || (a.cost === b.cost && a.order < b.order);

/** Minimal binary heap over search states: the cheapest, earliest-found state comes out first. */
class StateQueue {
  private readonly heap: SearchState[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(state: SearchState): void {
    const heap = this.heap;
    let i = heap.length;
    heap.push(state);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const p = heap[parent];
      if (!p || !cheaper(state, p)) break;
      heap[i] = p;
      i = parent;
    }
    heap[i] = state;
  }

  pop(): SearchState | undefined {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop();
    if (top === undefined || last === undefined || heap.length === 0) return top;
    let i = 0;
    for (;;) {
      const left = heap[2 * i + 1];
      if (!left) break;
      const right = heap[2 * i + 2];
      const childIndex = right && cheaper(right, left) ? 2 * i + 2 : 2 * i + 1;
      const child = heap[childIndex];
      if (!child || !cheaper(child, last)) break;
      heap[i] = child;
      i = childIndex;
    }
    heap[i] = last;
    return top;
  }
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
  const ids = [...origin.keys()];

  // Every widget under the drop has to move, so a drop on more than the allowance can never work.
  let underDrop = 0;
  for (const [id, r] of origin) if (id !== movedId && rectsOverlap(fixed, r)) underDrop++;
  if (underDrop > MAX_PUSHED_WIDGETS) return null;

  const rectOf = (shifted: ReadonlyMap<string, Rect>, id: string): Rect | undefined =>
    id === movedId ? fixed : (shifted.get(id) ?? origin.get(id));
  const travelled = (id: string, rect: Rect): number => {
    const o = origin.get(id);
    return o ? Math.abs(rect.x - o.x) + Math.abs(rect.y - o.y) : 0;
  };
  const firstOverlap = (shifted: ReadonlyMap<string, Rect>, id: string): string | undefined => {
    const rect = rectOf(shifted, id);
    if (!rect) return undefined;
    return ids.find((other) => {
      if (other === id) return false;
      const r = rectOf(shifted, other);
      return r !== undefined && rectsOverlap(rect, r);
    });
  };

  const open = new StateQueue();
  open.push({ shifted: new Map(), pending: [movedId], cost: 0, order: 0 });
  const seen = new Set<string>();
  let order = 1;
  for (let nodes = 0; open.size > 0 && nodes < MAX_SEARCH_NODES; nodes++) {
    const state = open.pop();
    if (!state) break;

    // Only widgets that changed can have new overlaps, so look at those, not at every pair.
    const pending = [...state.pending];
    let clash: readonly [string, string] | null = null;
    while (pending.length > 0 && !clash) {
      const p = pending[0] ?? movedId;
      const hit = firstOverlap(state.shifted, p);
      if (hit === undefined) pending.shift();
      else clash = [p, hit];
    }
    if (!clash) {
      const result = new Map(origin);
      result.set(movedId, fixed);
      for (const [id, r] of state.shifted) result.set(id, r);
      return result;
    }

    // Either member of the clash may be the one to give way, except the dropped widget.
    for (const id of clash) {
      if (id === movedId) continue;
      const otherId = id === clash[0] ? clash[1] : clash[0];
      const other = rectOf(state.shifted, otherId);
      const current = rectOf(state.shifted, id);
      if (!other || !current) continue;
      for (const rect of pushedPositions(current, other)) {
        if (!fitsBounds(rect, bounds) || rectsOverlap(rect, fixed)) continue;
        const shifted = new Map(state.shifted);
        if (travelled(id, rect) === 0) shifted.delete(id);
        else shifted.set(id, rect);
        if (shifted.size > MAX_PUSHED_WIDGETS) continue;
        const signature = [...shifted]
          .map(([key, r]) => `${key}:${r.x},${r.y}`)
          .sort()
          .join("|");
        if (seen.has(signature)) continue;
        seen.add(signature);
        const cost = state.cost - travelled(id, current) + travelled(id, rect);
        open.push({ shifted, pending: [id, ...pending.filter((p) => p !== id)], cost, order: order++ });
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

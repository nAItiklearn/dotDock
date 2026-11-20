/**
 * Edit-mode drag maths. Items live in lanes (the pinned apps and stacks, or the live tiles); a drag reorders
 * inside its lane, or files an app into a stack when it is dropped on the stack's middle.
 */
export interface LaneSpan {
  readonly key: string;
  /** Rest span along the axis, in dock-local px. */
  readonly start: number;
  readonly size: number;
  readonly isStack: boolean;
}

/** Share of a stack tile, around its centre, where a dropped app is filed into it rather than placed beside it. */
export const FILE_ZONE = 0.5;

export type DropIntent =
  | { readonly type: "reorder"; readonly index: number }
  | { readonly type: "file"; readonly stackKey: string };

const centreOf = (s: LaneSpan): number => s.start + s.size / 2;

/** Where the dragged item lands in the lane when its centre is at `centre`: the number of other items before it. */
export function dropIndex(lane: readonly LaneSpan[], draggedKey: string, centre: number): number {
  return lane.filter((s) => s.key !== draggedKey && centreOf(s) < centre).length;
}

/** What dropping at `centre` does. Only apps can be filed, and only on the middle of a stack. */
export function dropIntent(lane: readonly LaneSpan[], draggedKey: string, draggedIsApp: boolean, centre: number): DropIntent {
  if (draggedIsApp) {
    const stack = lane.find((s) => {
      if (!s.isStack || s.key === draggedKey) return false;
      const half = (s.size * FILE_ZONE) / 2;
      return Math.abs(centre - centreOf(s)) <= half;
    });
    if (stack) return { type: "file", stackKey: stack.key };
  }
  return { type: "reorder", index: dropIndex(lane, draggedKey, centre) };
}

/** The lane's keys with `draggedKey` moved to `index` among the others. */
export function moveKey(keys: readonly string[], draggedKey: string, index: number): string[] {
  const others = keys.filter((k) => k !== draggedKey);
  if (others.length === keys.length) return [...keys];
  others.splice(Math.min(Math.max(index, 0), others.length), 0, draggedKey);
  return others;
}

/**
 * How far every other item must slide to make room while a drag hovers over `index`: the lane keeps its first
 * start and its gaps, with the dragged item's slot moved to the drop position.
 */
export function slideOffsets(lane: readonly LaneSpan[], draggedKey: string, index: number, gap: number): Map<string, number> {
  const offsets = new Map<string, number>();
  const dragged = lane.find((s) => s.key === draggedKey);
  const first = lane[0];
  if (!dragged || !first) return offsets;
  const order = moveKey(
    lane.map((s) => s.key),
    draggedKey,
    index,
  );
  const byKey = new Map(lane.map((s) => [s.key, s]));
  let cursor = first.start;
  for (const key of order) {
    const span = byKey.get(key);
    if (!span) continue;
    if (key !== draggedKey) offsets.set(key, cursor - span.start);
    cursor += span.size + gap;
  }
  return offsets;
}

/** Where the dragged item's slot starts once dropped at `index`, so it can settle there. */
export function slotStart(lane: readonly LaneSpan[], draggedKey: string, index: number, gap: number): number | null {
  const first = lane[0];
  if (!first) return null;
  const order = moveKey(
    lane.map((s) => s.key),
    draggedKey,
    index,
  );
  const byKey = new Map(lane.map((s) => [s.key, s]));
  let cursor = first.start;
  for (const key of order) {
    if (key === draggedKey) return cursor;
    cursor += (byKey.get(key)?.size ?? 0) + gap;
  }
  return null;
}

/** Pixels the pointer must travel before a press turns into a drag, so clicks stay clicks. */
export const DRAG_THRESHOLD = 5;

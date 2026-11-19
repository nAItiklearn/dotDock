import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from "./format";

export type RotationPeriod = "hourly" | "daily";

/** Whole days or hours since the epoch, counted in local time so a new item appears at local midnight or on the hour. */
export function rotationTick(date: Date, period: RotationPeriod): number {
  const localMs = date.getTime() - date.getTimezoneOffset() * MS_PER_MINUTE;
  return Math.floor(localMs / (period === "daily" ? MS_PER_DAY : MS_PER_HOUR));
}

/** Small seeded generator (mulberry32): the same seed gives the same sequence in every window. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

/** One shuffled pass over 0..count-1, fixed by (count, cycle, salt). */
function cyclePermutation(count: number, cycle: number, salt: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  const random = seededRandom(Math.imul(cycle + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b) ^ count);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const held = order[i] ?? 0;
    order[i] = order[j] ?? 0;
    order[j] = held;
  }
  return order;
}

/**
 * Index into a list of `count` items for a rotation tick. Every item is shown once per cycle in a
 * shuffled order, and the same item never appears twice in a row, including across cycles.
 * `salt` keeps two widgets from walking their lists in step.
 */
export function rotationIndex(count: number, tick: number, salt = 0): number {
  if (count <= 1) return 0;
  if (count === 2) return ((tick % 2) + 2) % 2;
  const cycle = Math.floor(tick / count);
  const position = ((tick % count) + count) % count;
  const order = cyclePermutation(count, cycle, salt);
  if (position === 0) {
    const previousLast = cyclePermutation(count, cycle - 1, salt)[count - 1];
    if (order[0] === previousLast) return order[1] ?? 0;
  } else if (position === 1) {
    const previousLast = cyclePermutation(count, cycle - 1, salt)[count - 1];
    // Position 0 took order[1] in the case above; hand it order[0] here so no item repeats.
    if (order[0] === previousLast) return order[0] ?? 0;
  }
  return order[position] ?? 0;
}

export function pickRotated<T>(items: readonly T[], date: Date, period: RotationPeriod, salt = 0): T | undefined {
  return items[rotationIndex(items.length, rotationTick(date, period), salt)];
}

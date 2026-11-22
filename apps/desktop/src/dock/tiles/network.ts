import { HISTORY_MS } from "./history";

export interface RateSample {
  readonly at: number;
  /** Bytes received per second. */
  readonly down: number;
  /** Bytes sent per second. */
  readonly up: number;
}

export type Direction = "down" | "up";

/** A graph never scales to less than this, so line noise on an idle link does not fill it. */
export const MIN_SCALE_BYTES = 10_000;

const UNITS = [
  ["byte-per-second", 1],
  ["kilobyte-per-second", 1e3],
  ["megabyte-per-second", 1e6],
  ["gigabyte-per-second", 1e9],
] as const;

/** "4.2 MB/s" in the user's language, in the largest unit that keeps the number at one or more. */
export function formatRate(bytesPerSecond: number, locale?: string): string {
  const value = Math.max(0, Number.isFinite(bytesPerSecond) ? bytesPerSecond : 0);
  const [unit, size] = [...UNITS].reverse().find(([, s]) => value >= s) ?? UNITS[0];
  const scaled = value / size;
  return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: scaled < 10 ? 1 : 0 }).format(scaled);
}

/** Adds a sample and drops what scrolled out of the minute, keeping the newest one before the edge. */
export function appendRate(history: readonly RateSample[], sample: RateSample, windowMs = HISTORY_MS): readonly RateSample[] {
  const last = history[history.length - 1];
  if (last && sample.at <= last.at) return history;
  const next = [...history, sample];
  const cutoff = sample.at - windowMs;
  let keepFrom = 0;
  while (keepFrom + 1 < next.length && (next[keepFrom + 1]?.at ?? 0) <= cutoff) keepFrom++;
  return keepFrom === 0 ? next : next.slice(keepFrom);
}

/** The biggest rate in the window, or the smallest scale a graph uses: what a full column stands for. */
export function scaleOf(history: readonly RateSample[]): number {
  return Math.max(MIN_SCALE_BYTES, ...history.flatMap((s) => [s.down, s.up]));
}

/**
 * Lit dots per column for one direction over the last minute, against `scale`. Each column holds the latest sample at
 * the end of its slice of time, so a quiet stretch reads as a flat line.
 */
export function rateLevels(history: readonly RateSample[], direction: Direction, scale: number, now: number, cols: number, rows: number, windowMs = HISTORY_MS): readonly number[] {
  const step = windowMs / cols;
  const start = now - windowMs;
  return Array.from({ length: cols }, (_, c) => {
    const until = start + (c + 1) * step;
    let value: number | null = null;
    for (const sample of history) {
      if (sample.at > until) break;
      value = sample[direction];
    }
    if (value === null || value <= 0) return 0;
    return Math.min(rows, Math.max(1, Math.round((value / scale) * rows)));
  });
}

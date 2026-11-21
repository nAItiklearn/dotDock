/** How much of the past the system graph shows. */
export const HISTORY_MS = 60_000;

const PERCENT = 100;

export interface Sample {
  readonly at: number;
  /** Processor load, 0 to 100. */
  readonly cpu: number;
  /** Memory in use, 0 to 100. */
  readonly mem: number;
}

export type Metric = "cpu" | "mem";

/**
 * Adds a sample and drops what has scrolled out of the window. The newest sample older than the window is kept,
 * so the graph's left edge still has a value to start from. A sample at or before the newest one is ignored.
 */
export function appendSample(history: readonly Sample[], sample: Sample, windowMs = HISTORY_MS): readonly Sample[] {
  const last = history[history.length - 1];
  if (last && sample.at <= last.at) return history;
  const next = [...history, sample];
  const cutoff = sample.at - windowMs;
  let keepFrom = 0;
  while (keepFrom + 1 < next.length && (next[keepFrom + 1]?.at ?? 0) <= cutoff) keepFrom++;
  return keepFrom === 0 ? next : next.slice(keepFrom);
}

/**
 * Lit dots per column of a graph that spans the last `windowMs` ending at `now`. Each column shows the latest
 * sample taken by the end of its slice of time, so a quiet period (the provider only reports changes) reads as
 * a flat line, and a column before the first sample is empty.
 */
export function graphLevels(history: readonly Sample[], metric: Metric, now: number, cols: number, rows: number, windowMs = HISTORY_MS): readonly number[] {
  const step = windowMs / cols;
  const start = now - windowMs;
  return Array.from({ length: cols }, (_, c) => {
    const until = start + (c + 1) * step;
    let value: number | null = null;
    for (const sample of history) {
      if (sample.at > until) break;
      value = sample[metric];
    }
    if (value === null || value <= 0) return 0;
    return Math.min(rows, Math.max(1, Math.round((value / PERCENT) * rows)));
  });
}

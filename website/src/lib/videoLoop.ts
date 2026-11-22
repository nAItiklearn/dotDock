/** A recording's footage window: after the opening logo sting, before the closing card (tools/video-loops.mjs). */
export interface LoopWindow {
  readonly start: number;
  readonly end: number;
}

/** The window from a video's data attributes, or null when it has none or it makes no sense. */
export function loopWindow(start: string | undefined, end: string | undefined): LoopWindow | null {
  const s = Number(start);
  const e = Number(end);
  return start !== undefined && end !== undefined && Number.isFinite(s) && Number.isFinite(e) && s >= 0 && e > s ? { start: s, end: e } : null;
}

/** Where playback should be: back at the footage's start once it reaches the closing card, otherwise where it is. */
export function loopedTime(current: number, window: LoopWindow): number {
  return current >= window.end ? window.start : current;
}

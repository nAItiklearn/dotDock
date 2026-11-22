/**
 * Voice memos: the waveform drawn while recording and kept with each memo, and how long it is. The audio itself is
 * captured by the WebView (`memoRecorder.ts`) and stays on this device.
 */

/** Bars in a memo's saved waveform, and in the live one on the tile. */
export const MEMO_BARS = 40;
export const FACE_BARS = 5;
/** The most memos kept; recording another drops the oldest. */
export const MAX_MEMOS = 12;
/** A memo stops by itself after this, so a forgotten recording cannot fill the disk. */
export const MAX_MEMO_MS = 10 * 60_000;
/** Mid-point of an 8-bit time-domain sample from the analyser. */
const SILENCE = 128;
/** A voice near the microphone peaks around this loudness; louder is drawn full height. */
const FULL_SCALE = 0.5;

/** The loudness (root mean square, 0 to 1) of a block of 8-bit samples centred on 128. */
export function loudness(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = ((samples[i] ?? SILENCE) - SILENCE) / SILENCE;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) / FULL_SCALE);
}

/**
 * The loudness history squeezed or stretched to `bars` bars, each the loudest moment in its share of the history, so
 * a short word is not averaged away.
 */
export function bars(levels: readonly number[], count: number): number[] {
  if (levels.length === 0) return Array.from({ length: count }, () => 0);
  return Array.from({ length: count }, (_, i) => {
    const start = Math.floor((i * levels.length) / count);
    const end = Math.max(start + 1, Math.floor(((i + 1) * levels.length) / count));
    let peak = 0;
    for (let j = start; j < end && j < levels.length; j += 1) peak = Math.max(peak, levels[j] ?? 0);
    return peak;
  });
}

/** "0:07", "12:30": minutes and seconds, as a recorder shows them. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export interface MemoMeta {
  readonly id: string;
  readonly createdAt: number;
  readonly durationMs: number;
  /** MEMO_BARS loudness values, 0 to 1. */
  readonly peaks: readonly number[];
}

/** The list with a new memo first; the oldest beyond the limit are returned too, so their audio can be removed. */
export function addMemo(list: readonly MemoMeta[], memo: MemoMeta): { readonly kept: MemoMeta[]; readonly dropped: MemoMeta[] } {
  const all = [memo, ...list.filter((m) => m.id !== memo.id)];
  return { kept: all.slice(0, MAX_MEMOS), dropped: all.slice(MAX_MEMOS) };
}

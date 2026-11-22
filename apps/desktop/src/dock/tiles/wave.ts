/** Height of the wave's crest and trough around the fill line, in dots. */
const WAVE_AMPLITUDE = 0.9;
/** Full waves across the disc. */
const WAVE_CYCLES = 1;

export interface WaveDot {
  /** Column and row in the grid, row 0 at the top. */
  readonly col: number;
  readonly row: number;
  readonly lit: boolean;
}

/**
 * The dots of a round glass `size` dots across, filled from the bottom to `fill` (0 to 1) with a wavy surface.
 * An empty glass has no lit dots and a full one has all of them: the wave only shows in between.
 */
export function glassDots(fill: number, size: number): readonly WaveDot[] {
  const level = Math.min(1, Math.max(0, Number.isFinite(fill) ? fill : 0));
  const centre = (size - 1) / 2;
  const radius = size / 2;
  const amplitude = level <= 0 || level >= 1 ? 0 : WAVE_AMPLITUDE;
  const dots: WaveDot[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (Math.hypot(col - centre, row - centre) > radius - 0.5) continue;
      const surface = level * size + amplitude * Math.sin((col / (size - 1)) * Math.PI * 2 * WAVE_CYCLES);
      dots.push({ col, row, lit: size - row <= surface });
    }
  }
  return dots;
}

/** Share of the goal reached, 0 to 1; a goal of zero reads as empty. */
export function hydrationFill(loggedMl: number, goalMl: number): number {
  return goalMl > 0 ? Math.min(1, Math.max(0, loggedMl / goalMl)) : 0;
}

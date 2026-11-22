/**
 * Abstract app marks for the dock illustration: 3 x 3 dot patterns, listed by lit cell index.
 * They stand for apps without copying any brand's icon.
 */
export const DOCK_GLYPHS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8],
  [0, 3, 6, 7, 8],
  [0, 1, 2, 3, 5, 6, 7, 8],
  [1, 3, 4, 5, 7],
  [0, 2, 4, 6, 8],
  [0, 2, 3, 5, 6, 8],
  [1, 4, 7, 3, 5],
  [0, 1, 2, 4, 7],
];

/** SVG path data for a glyph's lit and unlit dots, on a 3 x 3 grid. */
export function glyphPaths(lit: readonly number[]): { on: string; off: string } {
  let on = "";
  let off = "";
  for (let i = 0; i < 9; i++) {
    const cx = (i % 3) + 0.5;
    const cy = Math.floor(i / 3) + 0.5;
    const d = `M${cx - 0.36} ${cy}a0.36 0.36 0 1 0 0.72 0a0.36 0.36 0 1 0 -0.72 0Z`;
    if (lit.includes(i)) on += d;
    else off += d;
  }
  return { on, off };
}

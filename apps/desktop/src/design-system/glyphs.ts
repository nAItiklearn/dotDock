/**
 * Original 5×7 dot-matrix glyphs for display numerals.
 * Each glyph is a list of rows; "#" is a lit cell. Letters use the Doto font instead,
 * so this table only holds what the big numerals need.
 */
export const GLYPH_ROWS = 7;

const RAW: Record<string, readonly string[]> = {
  "0": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  ":": [".", ".", "#", ".", "#", ".", "."],
  "%": ["##..#", "##.#.", "...#.", "..#..", ".#...", ".#.##", "#..##"],
  "/": ["....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...."],
  "°": [".#.", "#.#", ".#.", "...", "...", "...", "..."],
  "-": ["...", "...", "...", "###", "...", "...", "..."],
  ".": [".", ".", ".", ".", ".", ".", "#"],
  " ": ["..", "..", "..", "..", "..", "..", ".."],
};

export interface Glyph {
  readonly width: number;
  /** lit[row][col] */
  readonly lit: readonly (readonly boolean[])[];
}

const GLYPHS: ReadonlyMap<string, Glyph> = new Map(
  Object.entries(RAW).map(([ch, rows]) => {
    const width = rows[0]?.length ?? 0;
    return [ch, { width, lit: rows.map((r) => [...r].map((c) => c === "#")) }];
  }),
);

export function glyphFor(ch: string): Glyph {
  return GLYPHS.get(ch) ?? (GLYPHS.get(" ") as Glyph);
}

export function hasGlyph(ch: string): boolean {
  return GLYPHS.has(ch);
}

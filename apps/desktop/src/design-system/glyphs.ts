/**
 * Original dot-matrix glyph sets for display numerals. "#" is a lit cell.
 * - fine: 5×7, for dots and stripes, where thin strokes read well.
 * - bold: 3×5, for blocks: chunky strokes, no diagonals, so solid shapes stay clean.
 * Letters use the Doto font instead, so these only hold what numerals need.
 */
export type GlyphSet = "fine" | "bold";

const FINE: Record<string, readonly string[]> = {
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
  "°": [".#.", "#.#", ".#.", "...", "...", "...", "..."],
  "-": ["...", "...", "...", "###", "...", "...", "..."],
  " ": ["..", "..", "..", "..", "..", "..", ".."],
};

const BOLD: Record<string, readonly string[]> = {
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": ["##.", ".#.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", "###", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", "..#", "..#", "..#"],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "###"],
  ":": [".", "#", ".", "#", "."],
  "°": ["#", ".", ".", ".", "."],
  "-": ["...", "...", "###", "...", "..."],
  " ": [".", ".", ".", ".", "."],
};

export interface Glyph {
  readonly width: number;
  /** lit[row][col] */
  readonly lit: readonly (readonly boolean[])[];
}

function compile(raw: Record<string, readonly string[]>): ReadonlyMap<string, Glyph> {
  return new Map(
    Object.entries(raw).map(([ch, rows]) => {
      const width = rows[0]?.length ?? 0;
      return [ch, { width, lit: rows.map((r) => [...r].map((c) => c === "#")) }];
    }),
  );
}

const SETS: Record<GlyphSet, { readonly rows: number; readonly glyphs: ReadonlyMap<string, Glyph> }> = {
  fine: { rows: 7, glyphs: compile(FINE) },
  bold: { rows: 5, glyphs: compile(BOLD) },
};

export function glyphRows(set: GlyphSet): number {
  return SETS[set].rows;
}

export function glyphFor(set: GlyphSet, ch: string): Glyph {
  const { glyphs } = SETS[set];
  return glyphs.get(ch) ?? (glyphs.get(" ") as Glyph);
}

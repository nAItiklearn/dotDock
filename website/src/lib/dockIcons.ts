/**
 * Dock icons drawn in the product's own dot-matrix language: each is a 9 x 9 grid of dots, lit where the
 * bitmap has a `#`. They stand for kinds of app (a browser, a terminal, a chat) and copy no brand's mark.
 * The dock draws them in the tone of their category and leaves the unlit dots faint.
 */
export type DockIconName =
  | "browser"
  | "files"
  | "terminal"
  | "chat"
  | "music"
  | "calendar"
  | "code"
  | "branch"
  | "box"
  | "database";

const BITMAPS: Record<DockIconName, readonly string[]> = {
  browser: ["..#####..", ".#..#..#.", "#...#...#", "#...#...#", "#########", "#...#...#", "#...#...#", ".#..#..#.", "..#####.."],
  files: [".........", ".####....", ".#...####", ".#......#", ".#......#", ".#......#", ".#......#", ".########", "........."],
  terminal: [".#######.", "#.......#", "#.#.....#", "#..#....#", "#.#.....#", "#...###.#", "#.......#", ".#######.", "........."],
  chat: [".#######.", "#.......#", "#.#.#.#.#", "#.......#", "#.......#", ".#######.", "..#......", ".#.......", "........."],
  music: ["...#####.", "...#...#.", "...#.....", "...#.....", "...#.....", ".###.....", "#####....", ".###.....", "........."],
  calendar: [".#.....#.", "#########", "#.......#", "#.#.#.#.#", "#.......#", "#.#.#.#.#", "#.......#", "#########", "........."],
  code: [".........", "..##.##..", ".#.....#.", ".#.....#.", "#.......#", ".#.....#.", ".#.....#.", "..##.##..", "........."],
  branch: ["##.......", "##.......", ".#...##..", ".#..#..#.", ".#...##..", ".####....", ".#.......", "##.......", "##......."],
  box: ["..#####..", ".#.....#.", "#########", "#...#...#", "#...#...#", "#...#...#", "#########", ".#######.", "........."],
  database: [".#######.", "#########", ".#######.", "#.......#", ".#######.", "#.......#", ".#######.", "#########", ".#######."],
};

export interface DotIcon {
  readonly on: string;
  readonly off: string;
}

/** SVG path data for the lit and unlit dots of an icon, on a 9 x 9 grid. */
export function dotIcon(name: DockIconName): DotIcon {
  const rows = BITMAPS[name];
  let on = "";
  let off = "";
  const r = 0.36;
  rows.forEach((row, y) => {
    for (let x = 0; x < 9; x++) {
      const d = `M${x + 0.5 - r} ${y + 0.5}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
      if (row[x] === "#") on += d;
      else off += d;
    }
  });
  return { on, off };
}

import { circlePath } from "./matrixGeometry";
import { disc, minus, outline, paint, polygon, raster, rect, union, type Test } from "./rasterShapes";
import { WEATHER_PATTERNS } from "./weatherIcons";

/**
 * Original dot-matrix pictograms ("#" is a dot in the main colour, "o" one in the accent colour).
 * Round and diagonal shapes are rasterised from geometry so they stay symmetrical; the rest are
 * drawn by hand. Use them large (about 28 px and up): below that the dots blur, and `Icon` is the
 * better choice.
 */
const GRID = 11;

const BOLT = polygon([
  [7.8, 0.2],
  [1.8, 6.2],
  [5, 6.2],
  [3.2, 10.8],
  [9.4, 4],
  [6.2, 4],
  [8.6, 0.2],
]);

/** A cloud cut by a slash: no connection. */
function offlineShape(): Test {
  const lobes = union(disc(3.8, 6.9, 2.3), disc(6.2, 5.3, 3.1), disc(8.8, 7.1, 2.1), rect(3.8, 6.6, 8.8, 9.3));
  const slash =
    (width: number): Test =>
    (x, y) =>
      Math.abs(x - y) * Math.SQRT1_2 < width && x > 0.4 && x < 10.6;
  return union(minus(outline(lobes), slash(1.4)), slash(0.5));
}

const PATTERNS = {
  ...WEATHER_PATTERNS,
  bolt: raster(GRID, paint(BOLT, "#")),
  offline: raster(GRID, paint(offlineShape(), "#")),
  note: [
    "....#####",
    "....#####",
    "....#...#",
    "....#...#",
    "....#...#",
    "..###.###",
    ".####.###",
    ".####....",
    "..##.....",
  ],
  check: [
    ".........",
    ".........",
    "......#..",
    ".....##..",
    "#...##...",
    "##.##....",
    ".###.....",
    "..#......",
    ".........",
  ],
  plus: [
    ".........",
    "....#....",
    "....#....",
    "....#....",
    ".#######.",
    "....#....",
    "....#....",
    "....#....",
    ".........",
  ],
  alert: [
    "....#....",
    "....#....",
    "....#....",
    "....#....",
    "....#....",
    ".........",
    "....#....",
    ".........",
    ".........",
  ],
  empty: raster(GRID, paint(minus(disc(5.5, 5.5, 4.9), disc(5.5, 5.5, 3.5)), "#")),
} as const satisfies Record<string, readonly string[]>;

export type DotIconName = keyof typeof PATTERNS;

export interface IconGeometry {
  readonly cols: number;
  readonly rows: number;
  /** Dots in the main colour. */
  readonly path: string;
  /** Dots in the accent colour. */
  readonly accentPath: string;
}

const ICON_DOT_RADIUS = 0.44;
const cache = new Map<DotIconName, IconGeometry>();

export function buildIcon(name: DotIconName): IconGeometry {
  const hit = cache.get(name);
  if (hit) return hit;
  const rows: readonly string[] = PATTERNS[name];
  const main: string[] = [];
  const accent: string[] = [];
  rows.forEach((row, r) =>
    [...row].forEach((cell, c) => {
      if (cell === ".") return;
      (cell === "o" ? accent : main).push(circlePath(c + 0.5, r + 0.5, ICON_DOT_RADIUS));
    }),
  );
  const geometry: IconGeometry = {
    cols: rows[0]?.length ?? 0,
    rows: rows.length,
    path: main.join(""),
    accentPath: accent.join(""),
  };
  cache.set(name, geometry);
  return geometry;
}

export const DOT_ICON_NAMES = Object.keys(PATTERNS) as readonly DotIconName[];

/** Rows of a pictogram, for tests. */
export function iconRows(name: DotIconName): readonly string[] {
  return PATTERNS[name];
}

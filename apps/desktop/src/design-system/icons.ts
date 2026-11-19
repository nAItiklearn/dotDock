import { circlePath } from "./matrixGeometry";

/**
 * Original dot-matrix pictograms ("#" is a lit dot). Shapes that are round or diagonal are
 * rasterised from simple geometry so they stay symmetrical; the rest are drawn by hand.
 * Use them large (28 px and up): below that the dots blur, and `Icon` is the better choice.
 */

type Test = (x: number, y: number) => boolean;

const disc =
  (cx: number, cy: number, r: number): Test =>
  (x, y) =>
    (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const rect =
  (x0: number, y0: number, x1: number, y1: number): Test =>
  (x, y) =>
    x >= x0 && x <= x1 && y >= y0 && y <= y1;
const union =
  (...tests: Test[]): Test =>
  (x, y) =>
    tests.some((t) => t(x, y));
const minus =
  (a: Test, b: Test): Test =>
  (x, y) =>
    a(x, y) && !b(x, y);

/** Ray-casting point-in-polygon. */
function polygon(points: readonly (readonly [number, number])[]): Test {
  return (x, y) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i] ?? [0, 0];
      const [xj, yj] = points[j] ?? [0, 0];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

/** Samples a shape at cell centres and returns rows of "#" and ".". */
function raster(size: number, test: Test): readonly string[] {
  return Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => (test(c + 0.5, r + 0.5) ? "#" : ".")).join(""),
  );
}

const GRID = 11;

/** Cloud silhouette: three lobes on a flat base. `scale` and the offsets place it on the grid. */
function cloud(offsetX: number, offsetY: number, scale = 1): Test {
  const at = (x: number, y: number): [number, number] => [offsetX + x * scale, offsetY + y * scale];
  const [lx, ly] = at(3.4, 4.7);
  const [mx, my] = at(6.2, 3.1);
  const [rx, ry] = at(8.6, 4.9);
  return union(
    disc(lx, ly, 2.3 * scale),
    disc(mx, my, 3.1 * scale),
    disc(rx, ry, 2.1 * scale),
    rect(at(3.4, 0)[0], at(0, 4.4)[1], at(8.6, 0)[0], at(0, 7.1)[1]),
  );
}

function sunRays(cx: number, cy: number, radius: number, size: number): Test {
  const diagonal = radius * Math.SQRT1_2;
  const offsets: readonly (readonly [number, number])[] = [
    [radius, 0],
    [-radius, 0],
    [0, radius],
    [0, -radius],
    [diagonal, diagonal],
    [-diagonal, diagonal],
    [diagonal, -diagonal],
    [-diagonal, -diagonal],
  ];
  return union(...offsets.map(([dx, dy]) => disc(cx + dx, cy + dy, size)));
}

const SUN = union(disc(5.5, 5.5, 2.3), sunRays(5.5, 5.5, 4.5, 0.6));
const RAIN_CLOUD = cloud(0.6, -0.4);
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
function cloudOff(): Test {
  const slash = (width: number): Test => (x, y) => Math.abs(x - y) * Math.SQRT1_2 < width && x > 0.4 && x < 10.6;
  return union(minus(cloud(0.4, 2.2), slash(1.4)), slash(0.5));
}

const PATTERNS = {
  sun: raster(GRID, SUN),
  moon: raster(GRID, minus(disc(5.5, 5.5, 4.6), disc(8, 3.4, 3.9))),
  cloud: raster(GRID, cloud(0.4, 2.2)),
  "cloud-sun": raster(
    GRID,
    union(minus(union(disc(3.6, 3.6, 1.6), sunRays(3.6, 3.6, 3.1, 0.5)), cloud(3, 3.6, 0.85)), cloud(3, 3.6, 0.85)),
  ),
  rain: raster(
    GRID,
    union(RAIN_CLOUD, ...[2.8, 5.5, 8.2].flatMap((x) => [disc(x, 8.9, 0.6), disc(x - 0.9, 10.2, 0.6)])),
  ),
  snow: raster(
    GRID,
    union(RAIN_CLOUD, ...[3, 5.5, 8].map((x) => disc(x, 8.8, 0.6)), ...[4.2, 6.8].map((x) => disc(x, 10.3, 0.6))),
  ),
  fog: [
    "...........",
    "..#######..",
    "...........",
    ".#########.",
    "...........",
    "..#######..",
    "...........",
    ".#########.",
    "...........",
    "..#######..",
    "...........",
  ],
  storm: raster(
    GRID,
    union(
      cloud(0.6, -2),
      polygon([
        [7.2, 5.7],
        [3.6, 8.8],
        [5.8, 8.8],
        [4.6, 11],
        [8.6, 7.4],
        [6.4, 7.4],
        [8.2, 5.7],
      ]),
    ),
  ),
  bolt: raster(GRID, BOLT),
  offline: raster(GRID, cloudOff()),
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
  empty: [
    ".........",
    ".........",
    ".........",
    ".........",
    ".#.#.#.#.",
    ".........",
    ".........",
    ".........",
    ".........",
  ],
} as const satisfies Record<string, readonly string[]>;

export type DotIconName = keyof typeof PATTERNS;

export interface IconGeometry {
  readonly cols: number;
  readonly rows: number;
  readonly path: string;
}

const ICON_DOT_RADIUS = 0.44;
const cache = new Map<DotIconName, IconGeometry>();

export function buildIcon(name: DotIconName): IconGeometry {
  const hit = cache.get(name);
  if (hit) return hit;
  const rows: readonly string[] = PATTERNS[name];
  const dots: string[] = [];
  rows.forEach((row, r) =>
    [...row].forEach((cell, c) => {
      if (cell === "#") dots.push(circlePath(c + 0.5, r + 0.5, ICON_DOT_RADIUS));
    }),
  );
  const geometry: IconGeometry = { cols: rows[0]?.length ?? 0, rows: rows.length, path: dots.join("") };
  cache.set(name, geometry);
  return geometry;
}

export const DOT_ICON_NAMES = Object.keys(PATTERNS) as readonly DotIconName[];

/** Rows of a pictogram, for tests. */
export function iconRows(name: DotIconName): readonly string[] {
  return PATTERNS[name];
}

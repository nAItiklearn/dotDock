import { disc, minus, outline, paint, polygon, raster, rect, union, type Test } from "./rasterShapes";

/**
 * Weather pictograms for the WMO code groups, day and night. Original drawings on a 13 x 13 grid:
 * clouds are a one-dot outline, the sun or moon is solid in the accent colour, and rain, snow and
 * lightning are accent or main dots under the cloud. One accent per icon keeps them quiet.
 */
const GRID = 13;

/** Cloud silhouette: three lobes on a flat base, placed and scaled on the grid. `grow` fattens it. */
function cloudShape(offsetX: number, offsetY: number, scale: number, grow = 0): Test {
  const at = (x: number, y: number): [number, number] => [offsetX + x * scale, offsetY + y * scale];
  const [lx, ly] = at(3.4, 8.4);
  const [mx, my] = at(6.6, 6.4);
  const [rx, ry] = at(9.8, 8.4);
  return union(
    disc(lx, ly, 2.6 * scale + grow),
    disc(mx, my, 3.2 * scale + grow),
    disc(rx, ry, 2.6 * scale + grow),
    rect(at(3.4, 0)[0], at(0, 8.4)[1] - grow, at(9.8, 0)[0], at(0, 11)[1] + grow),
  );
}

/** A cloud drawn as an outline that hides whatever sits behind it. */
function cloudLayers(offsetX: number, offsetY: number, scale: number) {
  return [
    paint(cloudShape(offsetX, offsetY, scale, 0.9), "."),
    paint(outline(cloudShape(offsetX, offsetY, scale)), "#"),
  ] as const;
}

function sun(cx: number, cy: number, radius: number, rayRadius: number, raySize: number): Test {
  const diagonal = rayRadius * Math.SQRT1_2;
  const rays = (
    [
      [rayRadius, 0],
      [-rayRadius, 0],
      [0, rayRadius],
      [0, -rayRadius],
      [diagonal, diagonal],
      [-diagonal, diagonal],
      [diagonal, -diagonal],
      [-diagonal, -diagonal],
    ] as const
  ).map(([dx, dy]) => disc(cx + dx, cy + dy, raySize));
  return union(disc(cx, cy, radius), ...rays);
}

/** A crescent: a disc with a bite taken out of its upper right. */
function moon(cx: number, cy: number, radius: number): Test {
  return minus(disc(cx, cy, radius), disc(cx + radius * 0.6, cy - radius * 0.45, radius * 0.88));
}

const dots = (points: readonly (readonly [number, number])[], size = 0.55): Test =>
  union(...points.map(([x, y]) => disc(x, y, size)));

const dashes = (...rows: readonly (readonly [number, number, number])[]): Test =>
  union(...rows.map(([y, x0, x1]) => rect(x0, y - 0.4, x1, y + 0.4)));

const RAIN_CLOUD = cloudLayers(0, -2.6, 1);

const RAIN_STREAKS = dots(
  [4.5, 7.5, 10.5].flatMap((x) => [
    [x, 9.5],
    [x - 1, 10.5],
    [x - 2, 11.5],
  ] as const),
);

const SNOW_FLAKES = dots(
  [
    [4.5, 9.5],
    [3.5, 10.5],
    [5.5, 10.5],
    [4.5, 11.5],
    [9, 9.5],
    [8, 10.5],
    [10, 10.5],
    [9, 11.5],
    [6.8, 12.5],
  ],
  0.5,
);

const BOLT = polygon([
  [7.8, 8.2],
  [4.4, 11.4],
  [6.6, 11.4],
  [5.2, 13],
  [9.4, 9.4],
  [7.2, 9.4],
  [8.8, 8.2],
]);

const PARTLY_CLOUD = cloudLayers(0.3, 3.8, 0.85);
const SHOWERS_CLOUD = cloudLayers(0, 1.8, 0.78);
const SHOWER_DROPS = dots([
  [3.2, 11.5],
  [2.5, 12.5],
  [5.6, 11.5],
  [4.9, 12.5],
  [8, 11.5],
  [7.3, 12.5],
]);

export const WEATHER_PATTERNS = {
  "clear-day": raster(GRID, paint(sun(6.5, 6.5, 2.4, 5.2, 0.55), "o")),
  "clear-night": raster(
    GRID,
    paint(moon(6.5, 6.5, 5.3), "o"),
    paint(dots([[10.2, 3], [11.6, 6.2], [8.6, 1.4]], 0.5), "#"),
  ),
  "partly-day": raster(GRID, paint(sun(9, 4.2, 2.1, 3.8, 0.5), "o"), ...PARTLY_CLOUD),
  "partly-night": raster(GRID, paint(moon(9, 4.4, 3), "o"), ...PARTLY_CLOUD),
  cloudy: raster(GRID, ...cloudLayers(3.8, 0.6, 0.72), ...cloudLayers(0.2, 3.4, 0.9)),
  fog: raster(GRID, ...cloudLayers(1.2, -0.6, 0.8), paint(dashes([9.5, 2, 10], [11.5, 4, 12]), "#")),
  drizzle: raster(
    GRID,
    ...RAIN_CLOUD,
    paint(dots([[4.5, 9.5], [7.5, 9.5], [10.5, 9.5], [6, 11.5], [9, 11.5]]), "o"),
  ),
  rain: raster(GRID, ...RAIN_CLOUD, paint(RAIN_STREAKS, "o")),
  "showers-day": raster(GRID, paint(sun(9.8, 3.2, 1.7, 3.1, 0.45), "o"), ...SHOWERS_CLOUD, paint(SHOWER_DROPS, "#")),
  "showers-night": raster(GRID, paint(moon(9.8, 3.4, 2.6), "o"), ...SHOWERS_CLOUD, paint(SHOWER_DROPS, "#")),
  snow: raster(GRID, ...RAIN_CLOUD, paint(SNOW_FLAKES, "o")),
  thunder: raster(GRID, ...RAIN_CLOUD, paint(BOLT, "o")),
} as const satisfies Record<string, readonly string[]>;

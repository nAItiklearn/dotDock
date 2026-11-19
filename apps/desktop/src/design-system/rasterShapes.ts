/**
 * Tiny shape toolkit for drawing dot pictograms from geometry: describe a shape as a function of
 * a point, then sample it at the centre of every cell. Round and diagonal forms stay symmetrical
 * this way, which hand-typed rows rarely manage.
 */
export type Test = (x: number, y: number) => boolean;

/** "#" is a dot in the icon's main colour, "o" a dot in the accent colour, "." is empty. */
export type Mark = "#" | "o" | ".";

export const disc =
  (cx: number, cy: number, r: number): Test =>
  (x, y) =>
    (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

export const rect =
  (x0: number, y0: number, x1: number, y1: number): Test =>
  (x, y) =>
    x >= x0 && x <= x1 && y >= y0 && y <= y1;

export const union =
  (...tests: Test[]): Test =>
  (x, y) =>
    tests.some((t) => t(x, y));

export const minus =
  (a: Test, b: Test): Test =>
  (x, y) =>
    a(x, y) && !b(x, y);

/** Ray-casting point-in-polygon. */
export function polygon(points: readonly (readonly [number, number])[]): Test {
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

/** The one-dot-wide edge of a shape: cells inside it that touch a cell outside it. */
export function outline(shape: Test): Test {
  return (x, y) => shape(x, y) && !(shape(x - 1, y) && shape(x + 1, y) && shape(x, y - 1) && shape(x, y + 1));
}

export interface Layer {
  readonly test: Test;
  /** What the layer paints; "." erases what lies beneath it. */
  readonly mark: Mark;
}

/** Layers are painted in order, so a later one covers an earlier one. */
export function raster(size: number, ...layers: readonly Layer[]): readonly string[] {
  return Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => {
      let mark: Mark = ".";
      for (const layer of layers) if (layer.test(c + 0.5, r + 0.5)) mark = layer.mark;
      return mark;
    }).join(""),
  );
}

export const paint = (test: Test, mark: Mark): Layer => ({ test, mark });

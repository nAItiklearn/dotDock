import { describe, expect, it } from "vitest";
import { formatColor, type Rgba } from "./color";
import { ACCENT_MIN_CHROMA, extractPalette, hueDistance, MAX_SAMPLES, SWATCH_COUNT, type PixelGrid } from "./palette";

type Triplet = readonly [number, number, number];

/** Rows of pixels, each a colour repeated `count` times, laid out in one row-major grid. */
function grid(width: number, parts: readonly { readonly color: Triplet; readonly count: number; readonly alpha?: number }[]): PixelGrid {
  const pixels = parts.reduce((sum, p) => sum + p.count, 0);
  const data = new Uint8ClampedArray(pixels * 4);
  let at = 0;
  for (const { color, count, alpha = 255 } of parts) {
    for (let n = 0; n < count; n++) {
      data.set([...color, alpha], at);
      at += 4;
    }
  }
  return { width, height: pixels / width, data };
}

const solid = (color: Triplet, pixels = 256): PixelGrid => grid(16, [{ color, count: pixels }]);

const hex = (c: Rgba): string => formatColor(c);

describe("extractPalette", () => {
  it("has nothing to say about an empty or fully transparent picture", () => {
    expect(extractPalette({ width: 0, height: 0, data: [] })).toBeNull();
    expect(extractPalette(grid(4, [{ color: [255, 0, 0], count: 16, alpha: 0 }]))).toBeNull();
  });

  it("finds the single colour of a flat picture, as the whole of it", () => {
    const palette = extractPalette(solid([233, 66, 72]));
    expect(palette?.swatches).toHaveLength(1);
    expect(palette?.backdrop.share).toBe(1);
    const { r, g, b } = palette?.backdrop.color ?? { r: 0, g: 0, b: 0 };
    expect([Math.abs(r - 233), Math.abs(g - 66), Math.abs(b - 72)].every((d) => d <= 1)).toBe(true);
  });

  it("offers a vivid flat picture's colour as the accent, and no accent for a grey one", () => {
    expect(extractPalette(solid([233, 66, 72]))?.accents).toHaveLength(1);
    expect(extractPalette(solid([128, 128, 128]))?.accents).toEqual([]);
  });

  it("ranks groups by share and calls the biggest the backdrop", () => {
    const palette = extractPalette(
      grid(16, [
        { color: [12, 24, 60], count: 192 },
        { color: [240, 150, 40], count: 64 },
      ]),
    );
    expect(palette?.swatches.map((s) => Math.round(s.share * 100))).toEqual([75, 25]);
    expect(palette?.backdrop.lch.l).toBeLessThan(0.3);
    const total = palette?.swatches.reduce((sum, s) => sum + s.share, 0) ?? 0;
    expect(total).toBeCloseTo(1, 10);
  });

  it("prefers the vivid colour over the dull backdrop as the accent", () => {
    const palette = extractPalette(
      grid(16, [
        { color: [60, 62, 64], count: 192 },
        { color: [230, 60, 90], count: 64 },
      ]),
    );
    expect(palette?.accents).toHaveLength(1);
    expect(hex(palette?.accents[0]?.color as Rgba)).toBe("#e63c5a");
  });

  it("reports the mean lightness, low for a dark picture and high for a light one", () => {
    expect(extractPalette(solid([8, 8, 12]))?.lightness).toBeLessThan(0.2);
    expect(extractPalette(solid([245, 244, 240]))?.lightness).toBeGreaterThan(0.9);
  });

  it("offers one accent per hue, most vivid first", () => {
    const palette = extractPalette(
      grid(20, [
        { color: [90, 90, 90], count: 140 },
        { color: [230, 40, 40], count: 20 },
        { color: [235, 60, 55], count: 20 },
        { color: [40, 200, 70], count: 20 },
      ]),
    );
    const hues = palette?.accents.map((a) => a.lch.h) ?? [];
    expect(hues.length).toBeGreaterThanOrEqual(2);
    for (const [i, a] of hues.entries()) for (const b of hues.slice(i + 1)) expect(hueDistance(a, b)).toBeGreaterThanOrEqual(25);
    expect(palette?.accents.every((a) => a.lch.c >= ACCENT_MIN_CHROMA)).toBe(true);
  });

  it("does not take a speck of colour for an accent", () => {
    const palette = extractPalette(
      grid(50, [
        { color: [70, 70, 72], count: 2495 },
        { color: [255, 0, 0], count: 5 },
      ]),
    );
    expect(palette?.accents).toEqual([]);
  });

  it("ignores transparent pixels", () => {
    const palette = extractPalette(
      grid(8, [
        { color: [255, 0, 0], count: 32, alpha: 0 },
        { color: [0, 0, 255], count: 32 },
      ]),
    );
    expect(palette?.swatches).toHaveLength(1);
    expect(palette?.backdrop.lch.h).toBeGreaterThan(240);
    expect(palette?.backdrop.lch.h).toBeLessThan(280);
  });

  it("never returns more groups than asked for, however many colours there are", () => {
    const data = new Uint8ClampedArray(64 * 64 * 4);
    for (let p = 0; p < 64 * 64; p++) data.set([(p * 37) % 256, (p * 91) % 256, (p * 53) % 256, 255], p * 4);
    const palette = extractPalette({ width: 64, height: 64, data });
    expect(palette?.swatches.length).toBeLessThanOrEqual(SWATCH_COUNT);
    expect(palette?.swatches.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10);
  });

  it("samples a big picture instead of reading every pixel, and still finds its colours", () => {
    const side = 1024;
    expect(side * side).toBeGreaterThan(MAX_SAMPLES);
    const data = new Uint8ClampedArray(side * side * 4);
    for (let p = 0; p < side * side; p++) data.set(p < (side * side) / 2 ? [250, 250, 250, 255] : [10, 10, 10, 255], p * 4);
    const palette = extractPalette({ width: side, height: side, data });
    expect(palette?.swatches).toHaveLength(2);
    expect(palette?.swatches[0]?.share).toBeCloseTo(0.5, 1);
  });

  it("gives the same palette for the same picture", () => {
    const picture = grid(16, [
      { color: [20, 60, 120], count: 100 },
      { color: [250, 200, 60], count: 80 },
      { color: [200, 80, 80], count: 76 },
    ]);
    expect(extractPalette(picture)).toEqual(extractPalette(picture));
  });
});

describe("hueDistance", () => {
  it("takes the short way round the wheel", () => {
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
    expect(hueDistance(90, 90)).toBe(0);
  });
});

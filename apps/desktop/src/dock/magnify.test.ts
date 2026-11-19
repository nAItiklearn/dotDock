import { describe, expect, it } from "vitest";
import { computeMagnify, falloff, maxGrowth, scaleFor, type MagnifyConfig, type RestItem } from "./magnify";

const SIZE = 48;
const GAP = 7;
const PEAK = 1.25;
const RADIUS = 1.5 * (SIZE + GAP);
const FULL: MagnifyConfig = { peak: PEAK, radius: RADIUS, engage: 1 };

function row(count: number, flags: readonly boolean[] = []): RestItem[] {
  return Array.from({ length: count }, (_, i) => ({ start: i * (SIZE + GAP), size: SIZE, weight: (flags[i] ?? true) ? 1 : 0 }));
}
const centre = (i: number): number => i * (SIZE + GAP) + SIZE / 2;

describe("falloff", () => {
  it("is 1 at the pointer, 0 at the radius and beyond, and falls monotonically", () => {
    expect(falloff(0, RADIUS)).toBe(1);
    expect(falloff(RADIUS, RADIUS)).toBe(0);
    expect(falloff(RADIUS * 3, RADIUS)).toBe(0);
    let previous = 1;
    for (let d = 0; d <= RADIUS; d += 4) {
      const f = falloff(d, RADIUS);
      expect(f).toBeLessThanOrEqual(previous);
      previous = f;
    }
  });

  it("has zero slope at both ends, so the edge of the influence never creases", () => {
    expect(falloff(0.5, RADIUS)).toBeGreaterThan(0.9999);
    expect(falloff(RADIUS - 0.5, RADIUS)).toBeLessThan(0.0001);
  });
});

describe("scaleFor", () => {
  it("reaches the peak at the pointer and is off at engage 0 or peak 1", () => {
    expect(scaleFor(0, FULL)).toBeCloseTo(PEAK);
    expect(scaleFor(0, { ...FULL, engage: 0 })).toBe(1);
    expect(scaleFor(0, { ...FULL, peak: 1 })).toBe(1);
  });
});

describe("computeMagnify", () => {
  it("leaves the row untouched when not engaged", () => {
    const frame = computeMagnify(row(6), centre(2), { ...FULL, engage: 0 }, GAP);
    expect(frame.scale.every((s) => s === 1)).toBe(true);
    expect(frame.shift.every((s) => Math.abs(s) < 1e-9)).toBe(true);
    expect(frame.rowStart).toBeCloseTo(0);
    expect(frame.rowEnd).toBeCloseTo(6 * SIZE + 5 * GAP);
  });

  it("magnifies most under the pointer and less with distance", () => {
    const frame = computeMagnify(row(9), centre(4), FULL, GAP);
    const scales = frame.scale;
    expect(scales[4]).toBeCloseTo(PEAK);
    expect(scales[3]).toBeLessThan(scales[4] as number);
    expect(scales[2]).toBeLessThan(scales[3] as number);
    expect(scales[0]).toBe(1);
    expect(scales[3]).toBeCloseTo(scales[5] as number);
  });

  it("keeps the point under the pointer where it is", () => {
    const items = row(9);
    for (const pivot of [centre(2) + 5, centre(4), 3 * (SIZE + GAP) + 10, 5 * (SIZE + GAP) + SIZE - 1, -20, 600]) {
      const frame = computeMagnify(items, pivot, FULL, GAP);
      const hovered = frame.hovered;
      if (hovered < 0) continue;
      const item = items[hovered] as RestItem;
      const s = frame.scale[hovered] as number;
      const drawnStart = item.start + item.size / 2 + (frame.shift[hovered] as number) - (item.size * s) / 2;
      const fraction = (pivot - item.start) / item.size;
      expect(drawnStart + fraction * item.size * s).toBeCloseTo(pivot, 6);
    }
  });

  it("never lets two items overlap and keeps the gaps between them", () => {
    const items = row(12);
    for (let pivot = -30; pivot < 700; pivot += 11) {
      const frame = computeMagnify(items, pivot, FULL, GAP);
      for (let i = 1; i < items.length; i++) {
        const a = items[i - 1] as RestItem;
        const b = items[i] as RestItem;
        const endA = a.start + a.size / 2 + (frame.shift[i - 1] as number) + (a.size * (frame.scale[i - 1] as number)) / 2;
        const startB = b.start + b.size / 2 + (frame.shift[i] as number) - (b.size * (frame.scale[i] as number)) / 2;
        expect(startB - endA).toBeCloseTo(GAP, 6);
      }
    }
  });

  it("moves continuously: a one pixel move of the pointer changes nothing by more than a pixel or two", () => {
    const items = row(10);
    let previous = computeMagnify(items, 0, FULL, GAP);
    for (let pivot = 1; pivot < 560; pivot++) {
      const frame = computeMagnify(items, pivot, FULL, GAP);
      frame.shift.forEach((s, i) => expect(Math.abs(s - (previous.shift[i] as number))).toBeLessThan(2.5));
      frame.scale.forEach((s, i) => expect(Math.abs(s - (previous.scale[i] as number))).toBeLessThan(0.02));
      previous = frame;
    }
  });

  it("grows the row by exactly the extra width of the magnified items", () => {
    const items = row(9);
    const frame = computeMagnify(items, centre(4), FULL, GAP);
    const extra = items.reduce((sum, item, i) => sum + item.size * ((frame.scale[i] as number) - 1), 0);
    expect(frame.rowEnd - frame.rowStart).toBeCloseTo(9 * SIZE + 8 * GAP + extra, 6);
  });

  it("grows an item with a partial weight by that share of the peak", () => {
    const items = row(5).map((item, i) => (i === 2 ? { ...item, weight: 0.3 } : item));
    const frame = computeMagnify(items, centre(2), FULL, GAP);
    expect(frame.scale[2]).toBeCloseTo(1 + (PEAK - 1) * 0.3);
    expect(frame.scale[1]).toBeGreaterThan(1);
  });

  it("does not grow tiles but still moves them out of the way", () => {
    const items = row(6, [true, true, true, false, false, true]);
    const frame = computeMagnify(items, centre(1), FULL, GAP);
    expect(frame.scale[3]).toBe(1);
    expect(frame.shift[3]).toBeGreaterThan(0);
  });

  it("stays finite with a pointer far outside the row and with a single item", () => {
    const frame = computeMagnify(row(5), 5000, FULL, GAP);
    expect(frame.scale.every((s) => s === 1)).toBe(true);
    expect(frame.shift.every(Number.isFinite)).toBe(true);
    expect(computeMagnify(row(1), centre(0), FULL, GAP).scale[0]).toBeCloseTo(PEAK);
    expect(computeMagnify([], 10, FULL, GAP).hovered).toBe(-1);
  });

  it("reports the hovered item, counting half the gap on each side", () => {
    const items = row(4);
    expect(computeMagnify(items, centre(2), FULL, GAP).hovered).toBe(2);
    expect(computeMagnify(items, 2 * (SIZE + GAP) - 3, FULL, GAP).hovered).toBeGreaterThanOrEqual(1);
    expect(computeMagnify(items, -50, FULL, GAP).hovered).toBe(-1);
  });
});

describe("maxGrowth", () => {
  it("bounds the growth of every pointer position", () => {
    const items = row(11);
    const bound = maxGrowth(items, PEAK, RADIUS);
    for (let pivot = -40; pivot < 650; pivot += 7) {
      const frame = computeMagnify(items, pivot, FULL, GAP);
      const grown = frame.rowEnd - frame.rowStart - (11 * SIZE + 10 * GAP);
      expect(grown).toBeLessThanOrEqual(bound + 1e-6);
    }
  });

  it("is zero with magnification off", () => {
    expect(maxGrowth(row(5), 1, RADIUS)).toBe(0);
  });
});

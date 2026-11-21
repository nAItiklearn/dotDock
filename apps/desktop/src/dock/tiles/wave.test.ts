import { describe, expect, it } from "vitest";
import { glassDots, hydrationFill } from "./wave";

const SIZE = 9;
const lit = (fill: number): number => glassDots(fill, SIZE).filter((d) => d.lit).length;

describe("glassDots", () => {
  it("draws a round glass: no dot in the corners", () => {
    const dots = glassDots(0.5, SIZE);
    expect(dots.length).toBeLessThan(SIZE * SIZE);
    expect(dots.some((d) => d.col === 0 && d.row === 0)).toBe(false);
    expect(dots.some((d) => d.col === 4 && d.row === 4)).toBe(true);
  });

  it("is dark when empty and full of light when full", () => {
    expect(lit(0)).toBe(0);
    expect(lit(1)).toBe(glassDots(1, SIZE).length);
  });

  it("fills from the bottom: a lit dot always has a lit dot beneath it in its column", () => {
    const dots = glassDots(0.6, SIZE);
    for (const dot of dots.filter((d) => d.lit)) {
      const below = dots.filter((d) => d.col === dot.col && d.row > dot.row);
      expect(below.every((d) => d.lit)).toBe(true);
    }
  });

  it("rises with the fill", () => {
    const levels = [0.1, 0.3, 0.5, 0.7, 0.9].map(lit);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    expect(levels[0]).toBeLessThan(levels[4] ?? 0);
  });

  it("clamps what is out of range and what is not a number", () => {
    expect(lit(-3)).toBe(0);
    expect(lit(7)).toBe(glassDots(1, SIZE).length);
    expect(lit(Number.NaN)).toBe(0);
  });
});

describe("hydrationFill", () => {
  it("is the share of the goal, never past a full glass", () => {
    expect(hydrationFill(500, 2000)).toBe(0.25);
    expect(hydrationFill(3000, 2000)).toBe(1);
    expect(hydrationFill(-5, 2000)).toBe(0);
  });

  it("reads a goal of zero as empty rather than dividing by it", () => {
    expect(hydrationFill(500, 0)).toBe(0);
  });
});

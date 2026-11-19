import { describe, expect, it } from "vitest";
import type { Tone } from "../icons/frames";
import { edgeFade, landscape } from "./landscape";
import { GROUND_ROW, SCENE_COLS, SCENE_ROWS } from "./layout";

interface Cell {
  readonly c: number;
  readonly r: number;
  readonly v: number;
  readonly tone: Tone;
}

function cells(scroll: number, t: number): Cell[] {
  const out: Cell[] = [];
  landscape(scroll, t, (c, r, v, tone) => out.push({ c, r, v, tone }));
  return out;
}

describe("landscape", () => {
  it("stays on the lattice with brightness in 0..1", () => {
    for (const scroll of [0, 13, 250.7, 9000]) {
      for (const cell of cells(scroll, 1.3)) {
        expect(cell.c).toBeGreaterThanOrEqual(0);
        expect(cell.c).toBeLessThan(SCENE_COLS);
        expect(cell.r).toBeGreaterThanOrEqual(0);
        expect(cell.r).toBeLessThan(SCENE_ROWS);
        expect(cell.v).toBeGreaterThanOrEqual(0);
        expect(cell.v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is cheap: a few hundred lit dots", () => {
    for (const scroll of [0, 120, 4000]) {
      const lit = cells(scroll, 0.5).filter((c) => c.v > 0.03).length;
      expect(lit).toBeGreaterThan(150);
      expect(lit).toBeLessThan(800);
    }
  });

  it("is deterministic", () => {
    expect(cells(37, 2.2)).toEqual(cells(37, 2.2));
  });

  it("twinkles the stars in place without moving them", () => {
    const stars = (t: number): Cell[] => cells(0, t).filter((c) => c.r < 6 && c.tone === "neutral");
    const a = stars(0.1);
    const b = stars(1.7);
    expect(a.map((c) => `${c.c},${c.r}`)).toEqual(b.map((c) => `${c.c},${c.r}`));
    expect(a.some((cell, i) => Math.abs(cell.v - (b[i]?.v ?? 0)) > 0.05)).toBe(true);
  });

  it("scrolls the ground and its plants exactly with the world and the far hills more slowly", () => {
    const plants = (scroll: number): Set<string> => new Set(cells(scroll, 0).filter((c) => c.tone === "success").map((c) => `${c.c},${c.r}`));
    const before = plants(0);
    const after = plants(30);
    const moved = [...before].map((key) => key.split(",").map(Number) as [number, number]).filter(([c]) => c - 30 >= 16 && c - 30 < SCENE_COLS - 16);
    expect(moved.length).toBeGreaterThan(0);
    for (const [c, r] of moved) expect(after.has(`${c - 30},${r}`)).toBe(true);

    const farRidge = (scroll: number): number[] => cells(scroll, 0).filter((c) => c.tone === "dim" && c.r >= 8 && c.r <= 10 && c.v > 0.15 && c.v < 0.25).map((c) => c.c * 100 + c.r);
    expect(farRidge(0)).not.toEqual(farRidge(30));
  });

  it("grows plants from the ground and draws a dotted ground line under them", () => {
    const plants = cells(0, 0).filter((c) => c.tone === "success");
    expect(Math.max(...plants.map((c) => c.r))).toBe(GROUND_ROW);
    expect(cells(0, 0).filter((c) => c.r === GROUND_ROW + 1).length).toBeGreaterThan(30);
  });

  it("fades toward both ends so the strip never stops at a hard edge", () => {
    expect(edgeFade(0)).toBe(0);
    expect(edgeFade(SCENE_COLS - 1)).toBe(0);
    expect(edgeFade(SCENE_COLS / 2)).toBe(1);
    expect(edgeFade(5)).toBeGreaterThan(0);
    expect(edgeFade(5)).toBeLessThan(1);
  });
});

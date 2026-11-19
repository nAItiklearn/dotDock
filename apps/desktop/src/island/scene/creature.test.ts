import { describe, expect, it } from "vitest";
import type { Tone } from "../icons/frames";
import type { Phase } from "../protocol";
import { DONE_SETTLE, STATIC_POSE, creatureCells } from "./creature";
import { SPRITE_FEET } from "./layout";

interface Cell {
  readonly c: number;
  readonly r: number;
  readonly v: number;
  readonly tone: Tone;
}

const PHASES: readonly Phase[] = ["thinking", "reading", "searching", "editing", "running", "waiting", "done", "paused", "limit", "error", "stopped"];
const TIMES = Array.from({ length: 80 }, (_, i) => i * 0.137);

function cells(phase: Phase, tp: number, t: number, gait = 0, speed = 0): Cell[] {
  const out: Cell[] = [];
  creatureCells(phase, tp, t, gait, speed, (c, r, v, tone) => out.push({ c, r, v, tone }));
  return out;
}

describe("beetle poses", () => {
  it.each(PHASES)("%s only emits whole cells with brightness in 0..1, inside the headroom the strip leaves", (phase) => {
    for (const t of TIMES) {
      for (const cell of cells(phase, t, t, t * 3, 12)) {
        expect(Number.isInteger(cell.c)).toBe(true);
        expect(Number.isInteger(cell.r)).toBe(true);
        expect(cell.v).toBeGreaterThanOrEqual(0);
        expect(cell.v).toBeLessThanOrEqual(1);
        expect(cell.r).toBeGreaterThanOrEqual(-4);
        expect(cell.r).toBeLessThanOrEqual(SPRITE_FEET);
        expect(cell.c).toBeGreaterThanOrEqual(-10);
        expect(cell.c).toBeLessThanOrEqual(15);
      }
    }
  });

  it.each(PHASES)("%s is deterministic and shows a readable figure when motion is reduced", (phase) => {
    expect(cells(phase, 0.7, 1.9, 0.3, 4)).toEqual(cells(phase, 0.7, 1.9, 0.3, 4));
    const still = STATIC_POSE[phase];
    const lit = cells(phase, still.tp, still.t).filter((c) => c.v > 0.3);
    expect(lit.length).toBeGreaterThan(15);
    expect(lit.length).toBeLessThan(120);
  });

  it("stands on its feet in every upright pose", () => {
    for (const phase of ["thinking", "searching", "editing", "waiting", "paused"] as const) {
      expect(Math.max(...cells(phase, 1, 0.4).map((c) => c.r))).toBe(SPRITE_FEET);
    }
  });

  it("keeps one accent cell, its eye, in the working poses", () => {
    for (const phase of ["thinking", "reading", "searching", "editing", "running"] as const) {
      expect(cells(phase, 1, 0.4).filter((c) => c.tone === "accent")).toHaveLength(1);
    }
  });

  it("asks for attention with an accent exclamation mark above the head", () => {
    const accent = cells("waiting", 1, 0.3).filter((c) => c.tone === "accent");
    expect(accent.length).toBe(4);
    expect(Math.min(...accent.map((c) => c.r))).toBeLessThan(0);
  });

  it("uses the danger colour only when something is wrong", () => {
    const danger = (phase: Phase): number => cells(phase, 1, 0.4).filter((c) => c.tone === "danger").length;
    expect(danger("error")).toBeGreaterThan(3);
    expect(danger("limit")).toBe(1);
    for (const phase of ["thinking", "reading", "searching", "editing", "running", "waiting", "done", "paused", "stopped"] as const) {
      expect(danger(phase)).toBe(0);
    }
  });

  it("raises thought dots above the head while thinking", () => {
    const above = (t: number): number => cells("thinking", 1, t).filter((c) => c.r < 2 && c.c < 8).length;
    expect(above(0.2) + above(0.6) + above(1.0)).toBeGreaterThan(0);
  });

  it("sweeps its antennae while searching", () => {
    const frames = new Set([0.05, 0.4, 0.7, 1.0, 1.3].map((t) => JSON.stringify(cells("searching", 1, t))));
    expect(frames.size).toBeGreaterThan(2);
  });

  it("hops twice, then sits and throws a success-coloured spark", () => {
    const top = (tp: number): number => Math.min(...cells("done", tp, 0).filter((c) => c.tone === "neutral").map((c) => c.r));
    const sitting = top(DONE_SETTLE + 0.2);
    expect(top(0.18)).toBeLessThan(sitting);
    expect(top(0.5 + 0.18)).toBeLessThan(sitting);
    expect(cells("done", DONE_SETTLE + 0.2, 0).some((c) => c.tone === "success")).toBe(true);
    expect(cells("done", 0.1, 0).some((c) => c.tone === "success")).toBe(false);
  });

  it("blurs its legs and speeds along while running, and lifts alternate legs while walking", () => {
    const legCells = (phase: Phase, gait: number, speed: number): string => JSON.stringify(cells(phase, 1, 0.05, gait, speed).filter((c) => c.r >= 6));
    expect(cells("running", 1, 0.05, 0.1, 30).some((c) => c.v === 0.5)).toBe(true);
    expect(legCells("reading", 0.1, 9)).not.toBe(legCells("reading", 0.6, 9));
    expect(legCells("reading", 0.1, 0)).toBe(legCells("reading", 0.6, 0));
  });

  it("lies on its back with its legs in the air when it errors", () => {
    const lit = cells("error", 1, 0.05);
    const legs = lit.filter((c) => c.tone === "danger" && c.r < 4);
    expect(legs.length).toBeGreaterThan(3);
    expect(Math.max(...lit.map((c) => c.r))).toBe(SPRITE_FEET);
  });

  it("curls up with rising z's when stopped", () => {
    const early = cells("stopped", 1, 0.2).filter((c) => c.r < 3).length;
    const later = cells("stopped", 1, 1.4).filter((c) => c.r < 3).length;
    expect(early + later).toBeGreaterThan(0);
  });
});

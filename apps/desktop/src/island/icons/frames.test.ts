import { describe, expect, it } from "vitest";
import type { Phase } from "../protocol";
import { ICONS, LATTICE, iconKindFor, type IconKind } from "./frames";

const KINDS = Object.keys(ICONS) as IconKind[];
const WORKING: readonly IconKind[] = ["thinking", "reading", "searching", "editing", "running"];
const TIMES = Array.from({ length: 121 }, (_, i) => i * 0.0537);

function frame(kind: IconKind, t: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < LATTICE; r++) for (let c = 0; c < LATTICE; c++) out.push(ICONS[kind].cell(t, c, r));
  return out;
}

describe("icon frames", () => {
  it.each(KINDS)("%s keeps every cell within 0..1 at every time", (kind) => {
    for (const t of TIMES) for (const v of frame(kind, t)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it.each(KINDS)("%s is deterministic", (kind) => {
    for (const t of [0, 0.31, 1.7, 5.2]) expect(frame(kind, t)).toEqual(frame(kind, t));
  });

  it.each(KINDS)("%s shows something readable in its static pose", (kind) => {
    const lit = frame(kind, ICONS[kind].staticT).filter((v) => v > 0.3).length;
    expect(lit).toBeGreaterThan(0);
  });

  it.each(KINDS.filter((k) => ICONS[k].period !== null))("%s repeats exactly after its period", (kind) => {
    const period = ICONS[kind].period as number;
    for (const t of [0.011, 0.337, 0.911, 1.283]) {
      const a = frame(kind, t);
      const b = frame(kind, t + period);
      a.forEach((v, i) => expect(b[i]).toBeCloseTo(v, 6));
      expect(ICONS[kind].lead(t)).toEqual(ICONS[kind].lead(t + period));
    }
  });

  it.each(KINDS)("%s keeps its lead dot inside the lattice", (kind) => {
    for (const t of TIMES) {
      const lead = ICONS[kind].lead(t);
      if (!lead) continue;
      expect(lead.c).toBeGreaterThanOrEqual(0);
      expect(lead.c).toBeLessThan(LATTICE);
      expect(lead.r).toBeGreaterThanOrEqual(0);
      expect(lead.r).toBeLessThan(LATTICE);
      expect(lead.v).toBeGreaterThanOrEqual(0);
      expect(lead.v).toBeLessThanOrEqual(1);
    }
  });

  it("gives working states exactly one accent lead dot and the others none", () => {
    for (const kind of WORKING) expect(ICONS[kind].lead(0.4)).not.toBeNull();
    for (const kind of ["done", "paused", "limit", "error", "stopped"] as const) expect(ICONS[kind].lead(0.4)).toBeNull();
  });

  it("uses a distinct tone for success, failure and dim states", () => {
    expect(ICONS.done.tone).toBe("success");
    expect(ICONS.limit.tone).toBe("danger");
    expect(ICONS.error.tone).toBe("danger");
    expect(ICONS.paused.tone).toBe("dim");
    expect(ICONS.waiting.tone).toBe("accent");
    expect(ICONS.thinking.tone).toBe("neutral");
  });

  it("sweeps the ring round clockwise, then pops the check inside it, and holds", () => {
    const lit = (t: number): number => frame("done", t).filter((v) => v > 0.05).length;
    const ring = 16;
    const check = 4;
    expect(lit(0)).toBe(0);
    expect(lit(0.2)).toBeGreaterThan(0);
    expect(lit(0.2)).toBeLessThan(ring);
    expect(lit(ICONS.done.staticT)).toBe(ring + check);
    expect(lit(60)).toBe(ring + check);
    expect(ICONS.done.cell(0.2, 3, 0)).toBeGreaterThan(0.9);
    expect(ICONS.done.cell(0.2, 3, 6)).toBe(0);
    expect(ICONS.done.cell(0.2, 3, 4)).toBe(0);
  });

  it("drains the limit gauge from the top and leaves the bottom row blinking", () => {
    const rowSum = (t: number, r: number): number => {
      let sum = 0;
      for (let c = 2; c <= 4; c++) sum += ICONS.limit.cell(t, c, r);
      return sum;
    };
    expect(rowSum(0, 1)).toBe(3);
    expect(rowSum(1, 1)).toBe(0);
    expect(rowSum(1, 5)).toBe(3);
    const bottom = [2.0, 2.3, 2.9].map((t) => rowSum(t, 5));
    expect(Math.max(...bottom)).toBe(3);
    expect(Math.min(...bottom)).toBeLessThan(3);
  });

  it("only glitches at the start of each error cycle", () => {
    const clean = frame("error", 1);
    expect(frame("error", 0.9)).toEqual(clean);
    expect(frame("error", 0.02)).not.toEqual(clean);
  });

  it("types the editing rows in one after another and clears them at the end", () => {
    const litCells = (t: number): number => frame("editing", t).filter((v) => v > 0.05).length;
    expect(litCells(0.05)).toBe(0);
    expect(litCells(1.5)).toBeGreaterThan(litCells(0.5));
    expect(litCells(3.4)).toBe(14);
    expect(litCells(3.99)).toBeLessThanOrEqual(litCells(3.4));
  });

  it("scrolls running output upwards one row per step", () => {
    const column = (t: number): number[] => Array.from({ length: LATTICE }, (_, r) => ICONS.running.cell(t, 5, r));
    const a = column(0.01);
    const b = column(0.01 + 0.16);
    expect(b.slice(0, LATTICE - 1)).toEqual(a.slice(1));
  });

  it("maps phases to icons and borrows the standby dot for idle", () => {
    const phases: Phase[] = ["thinking", "reading", "searching", "editing", "running", "waiting", "done", "paused", "limit", "error", "stopped"];
    for (const phase of phases) expect(iconKindFor(phase)).toBe(phase);
    expect(iconKindFor("idle")).toBe("stopped");
  });
});

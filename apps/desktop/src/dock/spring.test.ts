import { describe, expect, it } from "vitest";
import { isSettled, omegaForSettle, rest, stepCritical, type SpringState } from "./spring";

const FRAME = 1 / 120;

function run(from: number, to: number, ms: number): { peak: number; value: number } {
  const state: SpringState = { x: from, v: 0 };
  const omega = omegaForSettle(200);
  let peak = from;
  for (let t = 0; t < ms / 1000; t += FRAME) {
    stepCritical(state, to, omega, FRAME);
    peak = to > from ? Math.max(peak, state.x) : Math.min(peak, state.x);
  }
  return { peak, value: state.x };
}

describe("stepCritical", () => {
  it("settles within the requested time", () => {
    const { value } = run(0, 1, 200);
    expect(Math.abs(value - 1)).toBeLessThan(0.03);
  });

  it("never overshoots from rest, in either direction", () => {
    expect(run(0, 1, 600).peak).toBeLessThanOrEqual(1);
    expect(run(1, 0, 600).peak).toBeGreaterThanOrEqual(0);
  });

  it("gives the same result at 30, 60 and 120 frames per second", () => {
    const end = (dt: number): number => {
      const s: SpringState = { x: 0, v: 0 };
      for (let step = 0; step < Math.round(0.2 / dt); step++) stepCritical(s, 1, 30, dt);
      return s.x;
    };
    expect(end(1 / 30)).toBeCloseTo(end(1 / 120), 6);
    expect(end(1 / 60)).toBeCloseTo(end(1 / 120), 6);
  });
});

describe("isSettled and rest", () => {
  it("settles after enough steps and rests on a value", () => {
    const s: SpringState = { x: 0, v: 0 };
    for (let i = 0; i < 300; i++) stepCritical(s, 5, 30, FRAME);
    expect(isSettled(s, 5, 0.01)).toBe(true);
    rest(s, 2);
    expect(s).toEqual({ x: 2, v: 0 });
    expect(isSettled(s, 5, 0.01)).toBe(false);
  });
});

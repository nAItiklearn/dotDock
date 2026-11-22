import { afterEach, describe, expect, it, vi } from "vitest";
import { BREATH_HIGH, BREATH_LOW, BREATH_MS, BREATH_STEP_MS, BREATH_STEPS, breathLevel, createBreather } from "./standby";

describe("breathLevel", () => {
  it("starts low, peaks halfway and comes back", () => {
    expect(breathLevel(0)).toBe(BREATH_LOW);
    expect(breathLevel(BREATH_STEPS / 2)).toBe(BREATH_HIGH);
    expect(breathLevel(BREATH_STEPS)).toBe(BREATH_LOW);
  });

  it("is symmetric, so the inhale and the exhale take as long", () => {
    for (let s = 1; s < BREATH_STEPS / 2; s++) expect(breathLevel(s)).toBe(breathLevel(BREATH_STEPS - s));
  });

  it("rises strictly to the peak", () => {
    for (let s = 1; s <= BREATH_STEPS / 2; s++) expect(breathLevel(s)).toBeGreaterThan(breathLevel(s - 1));
  });

  it("wraps for any step count, including negative ones", () => {
    expect(breathLevel(BREATH_STEPS * 5 + 3)).toBe(breathLevel(3));
    expect(breathLevel(-1)).toBe(breathLevel(BREATH_STEPS - 1));
  });

  it("changes a few times per second at most", () => {
    expect(BREATH_STEP_MS * BREATH_STEPS).toBe(BREATH_MS);
    expect(1000 / BREATH_STEP_MS).toBeLessThanOrEqual(4);
  });
});

describe("createBreather", () => {
  afterEach(() => vi.useRealTimers());

  it("steps through one breath and keeps going", () => {
    vi.useFakeTimers();
    const shown: number[] = [];
    const breather = createBreather((v) => shown.push(v));
    breather.start(true);
    vi.advanceTimersByTime(BREATH_MS * 2);
    expect(shown).toHaveLength(BREATH_STEPS * 2 + 1);
    expect(shown.slice(0, BREATH_STEPS + 1)).toEqual(Array.from({ length: BREATH_STEPS + 1 }, (_, s) => breathLevel(s)));
    breather.stop();
  });

  it("holds the dot at full light without a timer when it must not move", () => {
    vi.useFakeTimers();
    const shown: number[] = [];
    createBreather((v) => shown.push(v)).start(false);
    expect(shown).toEqual([BREATH_HIGH]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer behind when stopped or restarted", () => {
    vi.useFakeTimers();
    const breather = createBreather(() => undefined);
    breather.start(true);
    breather.start(true);
    expect(vi.getTimerCount()).toBe(1);
    breather.start(false);
    expect(vi.getTimerCount()).toBe(0);
    breather.start(true);
    breather.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

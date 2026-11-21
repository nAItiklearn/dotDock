import { describe, expect, it } from "vitest";
import { appendSample, graphLevels, HISTORY_MS, type Sample } from "./history";

const s = (at: number, cpu: number, mem = 50): Sample => ({ at, cpu, mem });

describe("appendSample", () => {
  it("keeps samples in order and ignores a repeat of the same instant", () => {
    const one = appendSample([], s(1000, 10));
    expect(appendSample(one, s(1000, 99))).toBe(one);
    expect(appendSample(one, s(500, 99))).toBe(one);
    expect(appendSample(one, s(2000, 20)).map((x) => x.at)).toEqual([1000, 2000]);
  });

  it("drops what scrolled out of the window but keeps the sample before the edge", () => {
    let history: readonly Sample[] = [];
    for (let at = 0; at <= 100_000; at += 10_000) history = appendSample(history, s(at, at / 1000));
    // Window is 60 s ending at 100 s: the sample at 40 s is the newest outside it, so it is kept as the starting value.
    expect(history[0]?.at).toBe(40_000);
    expect(history.at(-1)?.at).toBe(100_000);
  });

  it("is bounded however long it runs", () => {
    let history: readonly Sample[] = [];
    for (let at = 0; at < 3_600_000; at += 1000) history = appendSample(history, s(at, 10));
    expect(history.length).toBeLessThanOrEqual(HISTORY_MS / 1000 + 2);
  });
});

describe("graphLevels", () => {
  const rows = 10;

  it("has one level per column and is empty with no data", () => {
    expect(graphLevels([], "cpu", 60_000, 6, rows)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("scales a percentage to the rows", () => {
    expect(graphLevels([s(0, 50)], "cpu", 60_000, 4, rows)).toEqual([5, 5, 5, 5]);
    expect(graphLevels([s(0, 100)], "cpu", 60_000, 2, rows)).toEqual([10, 10]);
  });

  it("holds the last value through a quiet stretch", () => {
    // Window 0..60 s, six columns of 10 s: nothing reported after 5 s, so the line stays flat.
    expect(graphLevels([s(5000, 30)], "cpu", 60_000, 6, rows)).toEqual([3, 3, 3, 3, 3, 3]);
  });

  it("leaves the columns before the first sample empty", () => {
    expect(graphLevels([s(25_000, 50)], "cpu", 60_000, 6, rows)).toEqual([0, 0, 5, 5, 5, 5]);
  });

  it("follows a step up, oldest column on the left", () => {
    const levels = graphLevels([s(0, 20), s(30_000, 80)], "cpu", 60_000, 6, rows);
    expect(levels).toEqual([2, 2, 8, 8, 8, 8]);
  });

  it("always shows a dot for load above zero and none for zero", () => {
    expect(graphLevels([s(0, 1)], "cpu", 60_000, 1, rows)).toEqual([1]);
    expect(graphLevels([s(0, 0)], "cpu", 60_000, 1, rows)).toEqual([0]);
  });

  it("reads the metric asked for", () => {
    const history = [s(0, 10, 90)];
    expect(graphLevels(history, "mem", 60_000, 1, rows)).toEqual([9]);
  });
});

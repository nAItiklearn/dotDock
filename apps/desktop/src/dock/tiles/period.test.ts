import { describe, expect, it } from "vitest";
import { gridCells, nextMidnight, periodGrids } from "./period";

describe("periodGrids", () => {
  const noon = new Date(2026, 10, 20, 12, 0, 0);
  const grids = periodGrids(noon);

  it("splits the day into twenty-four hours on two rows of twelve", () => {
    expect(grids.day).toMatchObject({ total: 24, done: 12, cols: 12, rows: 2, order: "row", percent: 50 });
  });

  it("counts the days of the month and how many are over", () => {
    // 20 November: 19 whole days are over, half of today.
    expect(grids.month).toMatchObject({ total: 30, done: 19, order: "column", rows: 7, cols: 5, percent: 65 });
    expect(grids.month.partial).toBeCloseTo(0.5, 5);
  });

  it("counts the days of the year and how many are over", () => {
    expect(grids.year).toMatchObject({ total: 365, done: 323, rows: 7, cols: 53, percent: 88 });
  });

  it("knows a leap year has an extra day, and February a short month", () => {
    expect(periodGrids(new Date(2028, 5, 1)).year.total).toBe(366);
    expect(periodGrids(new Date(2026, 1, 10)).month.total).toBe(28);
    expect(periodGrids(new Date(2028, 1, 10)).month.total).toBe(29);
  });

  it("starts every period at zero", () => {
    const start = periodGrids(new Date(2026, 0, 1, 0, 0, 0));
    expect(start.day.percent).toBe(0);
    expect(start.month.percent).toBe(0);
    expect(start.year.percent).toBe(0);
    expect(start.year.done).toBe(0);
  });

  it("is never past its end, even in the last minute of the year", () => {
    const end = periodGrids(new Date(2026, 11, 31, 23, 59, 59));
    expect(end.year.done).toBeLessThanOrEqual(end.year.total);
    expect(end.year.percent).toBe(99);
    expect(end.day.percent).toBe(99);
  });
});

describe("gridCells", () => {
  const grids = periodGrids(new Date(2026, 10, 20, 12, 0, 0));

  it("lays the day out a row at a time and marks the current hour", () => {
    const cells = gridCells(grids.day);
    expect(cells).toHaveLength(24);
    expect(cells.filter((c) => c.state === "past")).toHaveLength(12);
    expect(cells[12]).toEqual({ col: 0, row: 1, state: "current" });
    expect(cells[11]).toEqual({ col: 11, row: 0, state: "past" });
    expect(cells[23]?.state).toBe("ahead");
  });

  it("lays the month out a week at a time, top to bottom", () => {
    const cells = gridCells(grids.month);
    expect(cells).toHaveLength(30);
    expect(cells[0]).toEqual({ col: 0, row: 0, state: "past" });
    expect(cells[7]).toEqual({ col: 1, row: 0, state: "past" });
    expect(cells[19]).toEqual({ col: 2, row: 5, state: "current" });
  });

  it("gives every cell its own place", () => {
    const seen = new Set(gridCells(grids.year).map((c) => `${c.col}:${c.row}`));
    expect(seen.size).toBe(365);
  });
});

describe("nextMidnight", () => {
  it("is the start of the next local day", () => {
    const evening = new Date(2026, 10, 20, 23, 30).getTime();
    expect(new Date(nextMidnight(evening))).toEqual(new Date(2026, 10, 21, 0, 0, 0, 0));
  });

  it("is a full day away at midnight itself, and rolls over a month end", () => {
    const midnight = new Date(2026, 10, 20, 0, 0).getTime();
    expect(new Date(nextMidnight(midnight))).toEqual(new Date(2026, 10, 21));
    expect(new Date(nextMidnight(new Date(2026, 10, 30, 12).getTime()))).toEqual(new Date(2026, 11, 1));
  });
});

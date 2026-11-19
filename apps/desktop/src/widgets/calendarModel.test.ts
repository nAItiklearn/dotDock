import { describe, expect, it } from "vitest";
import {
  buildMonth,
  daysInMonth,
  isoWeek,
  localeWeekStart,
  resolveWeekStart,
  shiftMonth,
  weekdayLabels,
  weekdayOrder,
} from "./calendarModel";

describe("buildMonth", () => {
  it("pads the first week so the 1st lands on the right weekday", () => {
    // 1 November 2026 is a Sunday.
    const monStart = buildMonth(2026, 10, 1);
    expect(monStart.cells.slice(0, 7)).toEqual([null, null, null, null, null, null, 1]);
    const sunStart = buildMonth(2026, 10, 0);
    expect(sunStart.cells.slice(0, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("always returns whole weeks and every day exactly once", () => {
    for (const weekStart of [0, 1, 6] as const) {
      for (let month = 0; month < 12; month++) {
        const model = buildMonth(2026, month, weekStart);
        expect(model.cells.length % 7).toBe(0);
        const days = model.cells.filter((c): c is number => c !== null);
        expect(days).toEqual(Array.from({ length: daysInMonth(2026, month) }, (_, i) => i + 1));
      }
    }
  });

  it("can be stretched to a fixed number of rows", () => {
    // February 2027 starts on a Monday and has 28 days: four rows on a Monday-first grid.
    expect(buildMonth(2027, 1, 1).weekCount).toBe(4);
    expect(buildMonth(2027, 1, 1, 6).weekCount).toBe(6);
    expect(buildMonth(2027, 1, 1, 6).cells).toHaveLength(42);
  });

  it("handles leap years", () => {
    expect(daysInMonth(2024, 1)).toBe(29);
    expect(daysInMonth(2026, 1)).toBe(28);
  });

  it("numbers each row by the ISO week of its first real day", () => {
    const model = buildMonth(2026, 10, 1);
    expect(model.weekNumbers).toHaveLength(model.weekCount);
    // The week containing Sunday 1 Nov 2026 is ISO week 44.
    expect(model.weekNumbers[0]).toBe(44);
  });
});

describe("isoWeek", () => {
  it("follows the ISO 8601 rules around the new year", () => {
    expect(isoWeek(new Date(2021, 0, 1))).toBe(53);
    expect(isoWeek(new Date(2024, 11, 30))).toBe(1);
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1);
    expect(isoWeek(new Date(2026, 10, 19))).toBe(47);
  });
});

describe("shiftMonth", () => {
  it("rolls the year in both directions", () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 5, 14)).toEqual({ year: 2027, month: 7 });
    expect(shiftMonth(2026, 5, -17)).toEqual({ year: 2025, month: 0 });
  });
});

describe("week start", () => {
  it("honours an explicit choice over the locale", () => {
    expect(resolveWeekStart("sun", "de-DE")).toBe(0);
    expect(resolveWeekStart("mon", "en-US")).toBe(1);
    expect(resolveWeekStart("sat", "en-US")).toBe(6);
  });

  it("follows the locale when set to auto", () => {
    expect(resolveWeekStart("auto", "en-US")).toBe(0);
    expect(resolveWeekStart("auto", "de-DE")).toBe(1);
    expect(localeWeekStart("not a tag")).toBe(1);
  });

  it("orders weekday columns from the chosen start", () => {
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(weekdayOrder(6)).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });

  it("labels columns in the locale, starting from the chosen day", () => {
    expect(weekdayLabels(1, "en-US")).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
    expect(weekdayLabels(0, "en-US")[0]).toBe("S");
  });
});

import { describe, expect, it } from "vitest";
import {
  clockParts,
  dayDifference,
  dayOffsetLabel,
  defaultTemperatureUnit,
  displayTemperature,
  formatDuration,
  formatGigabytePair,
  formatGigabytes,
  pad2,
  relativeDayLabel,
  wholePercent,
} from "./format";

const at = (h: number, m = 0, s = 0): { hour: number; minute: number; second: number } => ({ hour: h, minute: m, second: s });

describe("clockParts", () => {
  it("formats a 24-hour clock with leading zeros", () => {
    expect(clockParts(at(9, 5, 7), { hour24: true, leadingZero: true })).toEqual({
      hours: "09",
      minutes: "05",
      seconds: "07",
      meridiem: null,
    });
  });

  it("drops the leading zero on request, but never from minutes", () => {
    const parts = clockParts(at(9, 5), { hour24: true, leadingZero: false });
    expect(parts.hours).toBe("9");
    expect(parts.minutes).toBe("05");
  });

  it("maps midnight and noon on a 12-hour clock", () => {
    const format = { hour24: false, leadingZero: true };
    expect(clockParts(at(0, 30), format)).toMatchObject({ hours: "12", meridiem: "AM" });
    expect(clockParts(at(12, 0), format)).toMatchObject({ hours: "12", meridiem: "PM" });
    expect(clockParts(at(13, 15), format)).toMatchObject({ hours: "01", meridiem: "PM" });
    expect(clockParts(at(23, 59), format)).toMatchObject({ hours: "11", meridiem: "PM" });
  });
});

describe("formatDuration", () => {
  it("shows minutes and seconds under an hour", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(59_999)).toBe("00:59");
    expect(formatDuration(25 * 60_000)).toBe("25:00");
  });

  it("adds hours from one hour up", () => {
    expect(formatDuration(3_600_000)).toBe("1:00:00");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
  });

  it("reads negative values as zero", () => {
    expect(formatDuration(-5000)).toBe("00:00");
  });
});

describe("days", () => {
  it("counts whole calendar days, not 24-hour spans", () => {
    expect(dayDifference(new Date(2026, 10, 19, 23, 59), new Date(2026, 10, 20, 0, 1))).toBe(1);
    expect(dayDifference(new Date(2026, 10, 19, 0, 1), new Date(2026, 10, 19, 23, 59))).toBe(0);
    expect(dayDifference(new Date(2026, 10, 19), new Date(2026, 10, 12))).toBe(-7);
  });

  it("names neighbouring days in words", () => {
    expect(dayOffsetLabel(0, "en-US")).toBe("today");
    expect(dayOffsetLabel(1, "en-US")).toBe("tomorrow");
    expect(dayOffsetLabel(-1, "en-US")).toBe("yesterday");
  });

  it("switches to a weekday within a week and to a date beyond", () => {
    const now = new Date(2026, 10, 19);
    expect(relativeDayLabel(new Date(2026, 10, 20), now, "en-US")).toBe("tomorrow");
    expect(relativeDayLabel(new Date(2026, 10, 23), now, "en-US")).toBe("Mon");
    expect(relativeDayLabel(new Date(2026, 11, 2), now, "en-US")).toBe("Dec 2");
    expect(relativeDayLabel(new Date(2027, 0, 5), now, "en-US")).toBe("Jan 5, 2027");
  });
});

describe("temperature", () => {
  it("rounds and converts", () => {
    expect(displayTemperature(21.4, "c")).toBe(21);
    expect(displayTemperature(0, "f")).toBe(32);
    expect(displayTemperature(100, "f")).toBe(212);
    expect(displayTemperature(-40, "f")).toBe(-40);
  });

  it("defaults to Fahrenheit only where it is used", () => {
    expect(defaultTemperatureUnit("en-US")).toBe("f");
    expect(defaultTemperatureUnit("en-GB")).toBe("c");
    expect(defaultTemperatureUnit("de-DE")).toBe("c");
    expect(defaultTemperatureUnit("not a tag")).toBe("c");
  });
});

describe("sizes of things", () => {
  it("formats binary gigabytes with at most one decimal", () => {
    const gib = 1024 ** 3;
    expect(formatGigabytes(15.9 * gib, "en-US")).toBe("15.9 GB");
    expect(formatGigabytes(236 * gib, "en-US")).toBe("236 GB");
    expect(formatGigabytePair(10.34 * gib, 15.9 * gib, "en-US")).toBe("10.3 / 15.9 GB");
  });

  it("uses the locale's decimal separator", () => {
    expect(formatGigabytes(1.5 * 1024 ** 3, "de-DE")).toBe("1,5 GB");
  });

  it("rounds a share to a whole percent and survives an empty whole", () => {
    expect(wholePercent(1, 3)).toBe(33);
    expect(wholePercent(2, 3)).toBe(67);
    expect(wholePercent(5, 0)).toBe(0);
    expect(wholePercent(12, 10)).toBe(100);
  });

  it("pads to two digits", () => {
    expect(pad2(4)).toBe("04");
    expect(pad2(42)).toBe("42");
  });
});

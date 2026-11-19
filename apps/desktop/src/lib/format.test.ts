import { describe, expect, it } from "vitest";
import { formatGiB, formatHoursMinutes, percent } from "./format";

describe("formatGiB", () => {
  it("rounds binary gigabytes to a whole number", () => {
    expect(formatGiB(215 * 1024 ** 3)).toBe("215");
    expect(formatGiB(1.6 * 1024 ** 3)).toBe("2");
    expect(formatGiB(0)).toBe("0");
  });
});

describe("formatHoursMinutes", () => {
  it("shows hours and zero-padded minutes", () => {
    expect(formatHoursMinutes(2 * 3600 + 7 * 60)).toBe("2:07");
    expect(formatHoursMinutes(45 * 60)).toBe("0:45");
  });

  it("rounds to the nearest minute", () => {
    expect(formatHoursMinutes(89)).toBe("0:01");
    expect(formatHoursMinutes(29)).toBe("0:00");
  });

  it("returns null when the duration is unknown", () => {
    expect(formatHoursMinutes(null)).toBeNull();
    expect(formatHoursMinutes(0)).toBeNull();
    expect(formatHoursMinutes(-5)).toBeNull();
    expect(formatHoursMinutes(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("percent", () => {
  it("rounds and guards an empty whole", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(5, 0)).toBe(0);
  });
});

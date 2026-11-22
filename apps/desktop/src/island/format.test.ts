import { describe, expect, it, vi } from "vitest";
import { formatElapsed, formatTokens, tokensTick, warmTokenFormats } from "./format";

describe("formatTokens", () => {
  it("shows small counts in full with the locale's grouping", () => {
    expect(formatTokens(0, "en-US")).toBe("0");
    expect(formatTokens(842, "en-US")).toBe("842");
    expect(formatTokens(1284, "en-US")).toBe("1,284");
    expect(formatTokens(9999, "en-US")).toBe("9,999");
    expect(formatTokens(1284, "de-DE")).toBe("1.284");
  });

  it("switches to a compact form from ten thousand so the footer width stays put", () => {
    expect(formatTokens(10_000, "en-US")).toBe("10.0k");
    expect(formatTokens(12_480, "en-US")).toBe("12.5k");
    expect(formatTokens(123_456, "en-US")).toBe("123k");
    expect(formatTokens(1_340_000, "en-US")).toBe("1.3M");
  });

  it("never shows more than five characters", () => {
    for (const n of [0, 9, 99, 999, 9999, 10_000, 99_949, 100_000, 999_999, 1_000_000, 12_345_678]) {
      expect(formatTokens(n, "en-US").length).toBeLessThanOrEqual(5);
    }
  });

  // The soak test traced a 55 ms first expansion to a new number formatter per call; counts reuse them now.
  it("builds each formatter once, so animated counts and the first expansion stay cheap", () => {
    warmTokenFormats();
    formatTokens(1, "fr-FR");
    formatTokens(12_000, "fr-FR");
    const spy = vi.spyOn(Intl, "NumberFormat");
    const perCall = vi.spyOn(Number.prototype, "toLocaleString");
    for (let n = 0; n < 200_000; n += 997) formatTokens(n);
    formatTokens(5, "fr-FR");
    formatTokens(15_000, "fr-FR");
    expect(spy).not.toHaveBeenCalled();
    expect(perCall).not.toHaveBeenCalled();
    spy.mockRestore();
    perCall.mockRestore();
  });

  it("clamps negative and fractional input", () => {
    expect(formatTokens(-5, "en-US")).toBe("0");
    expect(formatTokens(41.6, "en-US")).toBe("42");
  });
});

describe("formatElapsed", () => {
  it("formats minutes and seconds", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_400)).toBe("0:07");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(12 * 60_000 + 3_000)).toBe("12:03");
  });

  it("adds hours past the first hour", () => {
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
    expect(formatElapsed(3_600_000 + 2 * 60_000 + 9_000)).toBe("1:02:09");
  });

  it("returns null while the start is unknown and never goes negative", () => {
    expect(formatElapsed(null)).toBeNull();
    expect(formatElapsed(Number.NaN)).toBeNull();
    expect(formatElapsed(-4_000)).toBe("0:00");
  });
});

describe("tokensTick", () => {
  it("ticks when the count grows, never when it repeats or a new turn starts again at 0", () => {
    expect(tokensTick(0, 412)).toBe(true);
    expect(tokensTick(412, 1310)).toBe(true);
    expect(tokensTick(1310, 1310)).toBe(false);
    expect(tokensTick(1310, 0)).toBe(false);
    expect(tokensTick(1310, 200)).toBe(false);
  });
});

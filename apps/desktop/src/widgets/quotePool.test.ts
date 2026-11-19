import { describe, expect, it } from "vitest";
import { SHORT_QUOTE_LIMIT } from "./data/quotes";
import { quotePool } from "./QuoteWidget";

describe("quote pool", () => {
  const base = { source: "bundled", rotation: "daily", customQuotes: [] } as const;

  it("keeps the circle to short quotes", () => {
    const pool = quotePool(base, "s");
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.every((q) => q.text.length <= SHORT_QUOTE_LIMIT)).toBe(true);
    expect(quotePool(base, "m").length).toBeGreaterThan(pool.length);
  });

  it("uses only the user's list when asked, and nothing when it is empty", () => {
    const custom = { ...base, source: "custom", customQuotes: ["Stay curious | Someone", ""] } as const;
    expect(quotePool(custom, "m")).toEqual([{ text: "Stay curious", author: "Someone", work: "" }]);
    expect(quotePool({ ...base, source: "custom" }, "m")).toEqual([]);
  });

  it("falls back to the full custom list when none is short enough for the circle", () => {
    const long = "word ".repeat(40).trim();
    expect(quotePool({ ...base, source: "custom", customQuotes: [long] }, "s")).toHaveLength(1);
  });

  it("puts the user's quotes first when mixing", () => {
    const both = { ...base, source: "both", customQuotes: ["Mine"] } as const;
    expect(quotePool(both, "m")[0]?.text).toBe("Mine");
  });
});

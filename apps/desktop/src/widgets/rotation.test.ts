import { describe, expect, it } from "vitest";
import { FACTS } from "./data/facts";
import { QUOTES, SHORT_QUOTES, parseCustomQuote } from "./data/quotes";
import { pickRotated, rotationIndex, rotationTick } from "./rotation";

describe("rotationIndex", () => {
  it.each([3, 4, 7, 24])("shows every item once per cycle with %i items", (count) => {
    for (let cycle = 0; cycle < 6; cycle++) {
      const seen = Array.from({ length: count }, (_, i) => rotationIndex(count, cycle * count + i));
      expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i));
    }
  });

  it.each([2, 3, 5, 24])("never repeats an item on the next tick with %i items", (count) => {
    for (let tick = 0; tick < count * 40; tick++) {
      expect(rotationIndex(count, tick)).not.toBe(rotationIndex(count, tick + 1));
    }
  });

  it("is deterministic, so every window shows the same item", () => {
    expect(rotationIndex(24, 12345)).toBe(rotationIndex(24, 12345));
  });

  it("walks two lists differently when given different salts", () => {
    const a = Array.from({ length: 24 }, (_, i) => rotationIndex(24, i, 1));
    const b = Array.from({ length: 24 }, (_, i) => rotationIndex(24, i, 2));
    expect(a).not.toEqual(b);
  });

  it("copes with one item, none, and negative ticks", () => {
    expect(rotationIndex(1, 99)).toBe(0);
    expect(rotationIndex(0, 99)).toBe(0);
    const value = rotationIndex(5, -3);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(5);
  });
});

describe("rotationTick", () => {
  it("changes at local midnight for daily rotation", () => {
    const before = rotationTick(new Date(2026, 10, 19, 23, 59, 59), "daily");
    const after = rotationTick(new Date(2026, 10, 20, 0, 0, 0), "daily");
    expect(after - before).toBe(1);
    expect(rotationTick(new Date(2026, 10, 19, 0, 0, 0), "daily")).toBe(rotationTick(new Date(2026, 10, 19, 23, 59, 59), "daily"));
  });

  it("changes on the hour for hourly rotation", () => {
    const before = rotationTick(new Date(2026, 10, 19, 10, 59, 59), "hourly");
    const after = rotationTick(new Date(2026, 10, 19, 11, 0, 0), "hourly");
    expect(after - before).toBe(1);
  });
});

describe("pickRotated", () => {
  it("returns undefined for an empty list", () => {
    expect(pickRotated([], new Date(), "daily")).toBeUndefined();
  });

  it("picks the same item all day", () => {
    const items = ["a", "b", "c", "d"];
    expect(pickRotated(items, new Date(2026, 10, 19, 1), "daily")).toBe(pickRotated(items, new Date(2026, 10, 19, 22), "daily"));
  });
});

describe("bundled content", () => {
  it("gives every quote an author, a source and text", () => {
    for (const q of QUOTES) {
      expect(q.text.trim()).not.toBe("");
      expect(q.author.trim()).not.toBe("");
      expect(q.work.trim()).not.toBe("");
    }
    expect(new Set(QUOTES.map((q) => q.text)).size).toBe(QUOTES.length);
  });

  it("keeps enough short quotes for the circle to rotate", () => {
    expect(SHORT_QUOTES.length).toBeGreaterThanOrEqual(10);
  });

  it("gives every fact a source note", () => {
    for (const f of FACTS) {
      expect(f.text.trim()).not.toBe("");
      expect(f.source.trim()).not.toBe("");
    }
    expect(new Set(FACTS.map((f) => f.text)).size).toBe(FACTS.length);
  });

  it("parses a user's own quote lines", () => {
    expect(parseCustomQuote("Stay curious | Someone")).toEqual({ text: "Stay curious", author: "Someone", work: "" });
    expect(parseCustomQuote("  Just the words  ")?.text).toBe("Just the words");
    expect(parseCustomQuote("A | B | C")?.author).toBe("B | C");
    expect(parseCustomQuote("   ")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { glyphFor, glyphRows } from "./glyphs";
import { DOT_ICON_NAMES, buildIcon, iconRows } from "./icons";
import { beadAnchor, buildMatrix } from "./matrixGeometry";
import { fillOrder, litCount } from "./primitives";

const DIGITS = "0123456789";

describe("glyph sets", () => {
  it.each(["fine", "bold"] as const)("%s digits are rectangular and as tall as the set says", (set) => {
    for (const ch of DIGITS) {
      const glyph = glyphFor(set, ch);
      expect(glyph.lit).toHaveLength(glyphRows(set));
      for (const row of glyph.lit) expect(row).toHaveLength(glyph.width);
    }
  });

  it("falls back to a blank cell for characters it does not draw", () => {
    const blank = glyphFor("bold", "?");
    expect(blank.lit.flat().some(Boolean)).toBe(false);
  });
});

describe("buildMatrix", () => {
  it("is as wide as its glyphs plus one cell between each pair", () => {
    const g = buildMatrix("10:00", "blocks");
    expect(g.rows).toBe(5);
    expect(g.cols).toBe(3 + 3 + 1 + 3 + 3 + 4);
  });

  it("keeps the colon apart so it can blink", () => {
    const withColon = buildMatrix("12:34", "blocks");
    const without = buildMatrix("1234", "blocks");
    expect(withColon.blinkPath).not.toBe("");
    expect(without.blinkPath).toBe("");
    expect(withColon.litPath).not.toBe("");
  });

  it("returns the same object for the same input", () => {
    expect(buildMatrix("09:41", "dots")).toBe(buildMatrix("09:41", "dots"));
  });

  it("draws unlit cells only for the dots style", () => {
    expect(buildMatrix("8", "dots").offPath).not.toBe("");
    expect(buildMatrix("8", "blocks").offPath).toBe("");
    expect(buildMatrix("8", "stripes").offPath).toBe("");
  });

  it("adds one accent bead per digit in the circles style and none elsewhere", () => {
    const beads = (text: string): number => (buildMatrix(text, "circles").accentPath.match(/M/g) ?? []).length;
    expect(beads("12:34")).toBe(4);
    expect(beads("7")).toBe(1);
    expect(buildMatrix("12:34", "blocks").accentPath).toBe("");
  });
});

describe("beadAnchor", () => {
  it("sits on the first stroke end in reading order", () => {
    // Bold "1": the top-left cell has one neighbour (to its right).
    expect(beadAnchor(glyphFor("bold", "1"))).toEqual({ row: 0, col: 0 });
    // Bold "5": top-left has two neighbours, so the first stroke end is the top-right.
    expect(beadAnchor(glyphFor("bold", "5"))).toEqual({ row: 0, col: 2 });
  });

  it("uses the bottom-right corner for a closed shape", () => {
    expect(beadAnchor(glyphFor("bold", "0"))).toEqual({ row: 4, col: 2 });
    expect(beadAnchor(glyphFor("bold", "8"))).toEqual({ row: 4, col: 2 });
  });
});

describe("dot gauges", () => {
  it("lights a proportional number of dots and clamps", () => {
    expect(litCount(0.5, 24)).toBe(12);
    expect(litCount(-1, 24)).toBe(0);
    expect(litCount(2, 24)).toBe(24);
    expect(litCount(Number.NaN, 24)).toBe(0);
  });

  it("fills columns left to right, each from the bottom", () => {
    // 3 columns x 2 rows, row-major indices: top row 0..2, bottom row 3..5.
    expect(fillOrder(3, 2, "columns")).toEqual([3, 0, 4, 1, 5, 2]);
    expect(fillOrder(3, 2, "rows")).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("visits every cell exactly once", () => {
    expect([...fillOrder(6, 4, "columns")].sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => i));
  });
});

describe("pictograms", () => {
  it.each(DOT_ICON_NAMES)("%s is a rectangle with at least one lit dot", (name) => {
    const rows = iconRows(name);
    const width = rows[0]?.length ?? 0;
    expect(rows.every((r) => r.length === width)).toBe(true);
    expect(rows.join("")).toMatch(/[#o]/);
    const geometry = buildIcon(name);
    expect(geometry.cols).toBe(width);
    expect(geometry.rows).toBe(rows.length);
  });

  it("draws the sun and the moon differently", () => {
    expect(iconRows("clear-day")).not.toEqual(iconRows("clear-night"));
  });
});

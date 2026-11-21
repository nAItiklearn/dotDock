import { describe, expect, it } from "vitest";
import type { BarLayout } from "./Bar";
import { glassRequest, sameGlass } from "./nativeGlass";

const layout = (w: number, h: number): BarLayout =>
  ({ bar: { x: 100.4, y: 900.6, w, h }, edge: "bottom", growth: 0, headroom: 0, metrics: {} }) as unknown as BarLayout;

describe("native glass", () => {
  it("puts one pill of acrylic behind the bar for the glass theme", () => {
    const request = glassRequest(layout(600, 64), "glass", false, true);
    expect(request.dark).toBe(true);
    expect(request.shapes).toHaveLength(1);
    const pill = request.shapes[0]!;
    expect(pill.radius).toBe(Math.min(pill.w, pill.h) / 2);
    expect(Number.isInteger(pill.x) && Number.isInteger(pill.y)).toBe(true);
  });

  it("asks for no glass for any other theme, while hidden, or before the first layout", () => {
    for (const theme of ["glass-lite", "obsidian", "paper", "aurum", "minimal"] as const) {
      expect(glassRequest(layout(600, 64), theme, false, false).shapes).toEqual([]);
    }
    expect(glassRequest(layout(600, 64), "glass", true, false).shapes).toEqual([]);
    expect(glassRequest(null, "glass", false, false).shapes).toEqual([]);
  });

  it("treats a vertical bar as a pill too", () => {
    const pill = glassRequest(layout(64, 500), "glass", false, false).shapes[0]!;
    expect(pill.radius).toBe(pill.w / 2);
  });

  it("only resends when the shapes or the tint change", () => {
    const a = glassRequest(layout(600, 64), "glass", false, true);
    expect(sameGlass(a, glassRequest(layout(600, 64), "glass", false, true))).toBe(true);
    expect(sameGlass(a, glassRequest(layout(600, 64), "glass", false, false))).toBe(false);
    expect(sameGlass(a, glassRequest(layout(640, 64), "glass", false, true))).toBe(false);
  });
});

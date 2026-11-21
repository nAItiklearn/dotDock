import { describe, expect, it } from "vitest";
import type { BarLayout } from "./Bar";
import { readFileSync } from "node:fs";
import { GLASS_PLATE_ROUND, glassRequest, sameGlass } from "./nativeGlass";

const layout = (w: number, h: number): BarLayout =>
  ({ bar: { x: 100.4, y: 900.6, w, h }, edge: "bottom", growth: 0, headroom: 0, metrics: {} }) as unknown as BarLayout;

describe("native glass", () => {
  it("cuts the acrylic with the same corners the glass theme draws", () => {
    const css = readFileSync(new URL("./dock.css", import.meta.url), "utf8");
    const block = css.slice(css.indexOf('.dock-root[data-dock-theme="glass"] {'));
    const round = /--plate-round:\s*([\d.]+)/.exec(block.slice(0, block.indexOf("}")));
    expect(Number(round?.[1])).toBe(GLASS_PLATE_ROUND);
  });

  it("puts one rounded plate of acrylic behind the bar for the glass theme", () => {
    const request = glassRequest(layout(600, 64), "glass", false, true);
    expect(request.dark).toBe(true);
    expect(request.shapes).toHaveLength(1);
    const pill = request.shapes[0]!;
    expect(pill.radius).toBe(Math.round(Math.min(pill.w, pill.h) * GLASS_PLATE_ROUND));
    expect(Number.isInteger(pill.x) && Number.isInteger(pill.y)).toBe(true);
  });

  it("asks for no glass for any other theme, while hidden, or before the first layout", () => {
    for (const theme of ["glass-lite", "obsidian", "paper", "aurum", "minimal"] as const) {
      expect(glassRequest(layout(600, 64), theme, false, false).shapes).toEqual([]);
    }
    expect(glassRequest(layout(600, 64), "glass", true, false).shapes).toEqual([]);
    expect(glassRequest(null, "glass", false, false).shapes).toEqual([]);
  });

  it("takes the corners from the bar's thickness whatever its direction", () => {
    const pill = glassRequest(layout(64, 500), "glass", false, false).shapes[0]!;
    expect(pill.radius).toBe(Math.round(pill.w * GLASS_PLATE_ROUND));
  });

  it("only resends when the shapes or the tint change", () => {
    const a = glassRequest(layout(600, 64), "glass", false, true);
    expect(sameGlass(a, glassRequest(layout(600, 64), "glass", false, true))).toBe(true);
    expect(sameGlass(a, glassRequest(layout(600, 64), "glass", false, false))).toBe(false);
    expect(sameGlass(a, glassRequest(layout(640, 64), "glass", false, true))).toBe(false);
  });
});

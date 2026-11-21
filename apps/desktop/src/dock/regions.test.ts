import { describe, expect, it } from "vitest";
import { HIT_MARGIN } from "./geometry";
import { alongAxis, computeRegions, coversWindow, dockZone, HOT_ZONE, hotStrip, measurePanels, sameRegions, snapRect, towardInside, type RegionInput } from "./regions";

const VIEWPORT = { w: 1536, h: 864 };
const BAR = { x: 400, y: 770, w: 700, h: 68 };

const base: RegionInput = { bar: BAR, edge: "bottom", engaged: false, headroom: 34, growth: 80, hidden: false, panels: [], fullscreen: false, viewport: VIEWPORT };

describe("towardInside and alongAxis", () => {
  it("extends the rect towards the middle of the screen on every edge", () => {
    expect(towardInside(BAR, "bottom", 30)).toEqual({ x: 400, y: 740, w: 700, h: 98 });
    expect(towardInside(BAR, "top", 30)).toEqual({ x: 400, y: 770, w: 700, h: 98 });
    expect(towardInside(BAR, "left", 30)).toEqual({ x: 400, y: 770, w: 730, h: 68 });
    expect(towardInside(BAR, "right", 30)).toEqual({ x: 370, y: 770, w: 730, h: 68 });
  });
  it("grows along the dock's own axis", () => {
    expect(alongAxis(BAR, "bottom", 10)).toEqual({ x: 390, y: 770, w: 720, h: 68 });
    expect(alongAxis(BAR, "left", 10)).toEqual({ x: 400, y: 760, w: 700, h: 88 });
  });
});

describe("computeRegions", () => {
  it("covers only the bar at rest", () => {
    const [bar] = computeRegions(base);
    expect(bar).toEqual({ x: 400 - HIT_MARGIN, y: 770 - HIT_MARGIN, w: 700 + 2 * HIT_MARGIN, h: 68 + 2 * HIT_MARGIN });
  });

  it("covers the headroom and the growth while engaged, so magnified icons stay clickable", () => {
    const zone = dockZone({ ...base, engaged: true });
    expect(zone.y).toBe(770 - HIT_MARGIN - 34);
    expect(zone.x).toBe(400 - HIT_MARGIN - 80);
    expect(zone.x + zone.w).toBe(1100 + HIT_MARGIN + 80);
  });

  it("shrinks to a thin strip on the screen edge while hidden", () => {
    const [strip] = computeRegions({ ...base, hidden: true });
    expect(strip).toEqual({ x: 400, y: VIEWPORT.h - HOT_ZONE, w: 700, h: HOT_ZONE });
    expect(hotStrip(BAR, "top", VIEWPORT).y).toBe(0);
    expect(hotStrip({ x: 10, y: 300, w: 68, h: 400 }, "left", VIEWPORT).w).toBe(HOT_ZONE);
    expect(hotStrip({ x: 1450, y: 300, w: 68, h: 400 }, "right", VIEWPORT).x).toBe(VIEWPORT.w - HOT_ZONE);
  });

  it("adds each open panel as drawn, and covers the whole window only for the App Library", () => {
    const panel = { x: 600, y: 400, w: 300, h: 300 };
    const regions = computeRegions({ ...base, panels: [panel] });
    expect(regions).toHaveLength(2);
    expect(regions[1]).toEqual({ x: 600 - HIT_MARGIN, y: 400 - HIT_MARGIN, w: 300 + 2 * HIT_MARGIN, h: 300 + 2 * HIT_MARGIN });
    expect(computeRegions({ ...base, fullscreen: true, panels: [panel] })).toEqual([{ x: 0, y: 0, w: VIEWPORT.w, h: VIEWPORT.h }]);
  });

  it("never takes the whole window while a popover, menu or gallery is open", () => {
    const popovers = [
      { x: 600, y: 400, w: 340, h: 380 },
      { x: 450, y: 180, w: 660, h: 560 },
      { x: 900, y: 600, w: 236, h: 190 },
    ];
    for (const edge of ["bottom", "top", "left", "right"] as const) {
      for (const engaged of [false, true]) {
        for (const rect of computeRegions({ ...base, edge, engaged, panels: popovers })) expect(coversWindow(rect, VIEWPORT)).toBe(false);
      }
    }
    const total = computeRegions({ ...base, panels: popovers }).reduce((sum, r) => sum + r.w * r.h, 0);
    expect(total / (VIEWPORT.w * VIEWPORT.h)).toBeLessThan(0.5);
  });

  it("measures panels as drawn and skips ones that are mounted but not shown", () => {
    const box = (left: number, top: number, width: number, height: number) => ({ getBoundingClientRect: () => ({ left, top, width, height }) });
    expect(measurePanels([box(10, 20, 300, 200), box(0, 0, 0, 0)])).toEqual([{ x: 10, y: 20, w: 300, h: 200 }]);
  });
});

describe("sameRegions and snapRect", () => {
  it("compares lists by value and rounds outwards", () => {
    expect(sameRegions([BAR], [{ ...BAR }])).toBe(true);
    expect(sameRegions([BAR], [{ ...BAR, w: 701 }])).toBe(false);
    expect(sameRegions([BAR], [])).toBe(false);
    expect(snapRect({ x: 10.4, y: 20.6, w: 100.2, h: 50.9 })).toEqual({ x: 10, y: 20, w: 101, h: 51 });
  });
});

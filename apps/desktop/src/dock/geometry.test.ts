import { describe, expect, it } from "vitest";
import {
  anchorPoint,
  clampIconSize,
  clampMagnification,
  fitIconSize,
  gridColumns,
  ICON_LIMITS,
  MAGNIFICATION_LIMITS,
  metricsFor,
  placeBesideDock,
  placeMenu,
  popoverSize,
  POPOVER,
  previewLayout,
  PREVIEW,
  rowLength,
  SCREEN_MARGIN,
  type LengthKind,
} from "./geometry";

const VIEWPORT = { w: 1536, h: 864 };

describe("clamps", () => {
  it("keeps icon size and magnification inside their limits and replaces garbage", () => {
    expect(clampIconSize(10)).toBe(ICON_LIMITS.min);
    expect(clampIconSize(500)).toBe(ICON_LIMITS.max);
    expect(clampIconSize(Number.NaN)).toBe(ICON_LIMITS.fallback);
    expect(clampMagnification(0.2)).toBe(MAGNIFICATION_LIMITS.min);
    expect(clampMagnification(9)).toBe(MAGNIFICATION_LIMITS.max);
    expect(clampMagnification(Number.POSITIVE_INFINITY)).toBe(MAGNIFICATION_LIMITS.fallback);
  });
});

describe("metricsFor", () => {
  it("derives every size from the icon size", () => {
    const small = metricsFor(40);
    const large = metricsFor(64);
    expect(small.bar).toBe(small.icon + 2 * small.pad);
    expect(large.gap).toBeGreaterThan(small.gap);
    expect(large.reach).toBeGreaterThan(small.reach);
  });
});

describe("fitIconSize", () => {
  const kinds: LengthKind[] = Array.from({ length: 24 }, () => "item");
  it("keeps the requested size when the row fits", () => {
    expect(fitIconSize(48, kinds, 4000)).toBe(48);
  });
  it("shrinks until the row fits, but not below the minimum", () => {
    const fitted = fitIconSize(64, kinds, 900);
    expect(fitted).toBeLessThan(64);
    expect(rowLength(kinds, fitted)).toBeLessThanOrEqual(900);
    expect(fitIconSize(64, kinds, 50)).toBe(ICON_LIMITS.min);
  });
});

describe("popover geometry", () => {
  it("picks near-square grids inside the column limits", () => {
    expect(gridColumns(1)).toBe(POPOVER.minCols);
    expect(gridColumns(9)).toBe(3);
    expect(gridColumns(10)).toBe(4);
    expect(gridColumns(200)).toBe(POPOVER.maxCols);
  });
  it("scrolls only beyond the row limit and never grows past it", () => {
    const small = popoverSize(6);
    const huge = popoverSize(80);
    expect(small.scrolls).toBe(false);
    expect(huge.scrolls).toBe(true);
    expect(huge.h).toBe(popoverSize(POPOVER.maxCols * POPOVER.maxRows).h);
  });
});

describe("placeBesideDock", () => {
  const anchor = { x: 700, y: 780, w: 48, h: 48 };
  const size = { w: 330, h: 300 };
  it("opens above a bottom dock, centred on the tile", () => {
    const p = placeBesideDock(anchor, size, VIEWPORT, 20);
    expect(p.y + size.h).toBe(anchor.y - 20);
    expect(p.x + size.w / 2).toBe(anchor.x + anchor.w / 2);
  });
  it("keeps the panel on screen when the tile is near a corner", () => {
    const p = placeBesideDock({ ...anchor, x: 4 }, size, VIEWPORT, 20);
    expect(p.x).toBe(SCREEN_MARGIN);
    const q = placeBesideDock({ ...anchor, x: 1530 }, size, VIEWPORT, 20);
    expect(q.x + size.w).toBe(VIEWPORT.w - SCREEN_MARGIN);
  });
});

describe("the dock is bottom-centred", () => {
  it("has no other position: panels open above the bar, centred on it, and menus attach to its top edge", () => {
    const bar = { x: 600, y: 800, w: 336, h: 60 };
    const panel = placeBesideDock(bar, { w: 200, h: 100 }, VIEWPORT, 12);
    expect(panel.y + 100).toBe(bar.y - 12);
    expect(panel.x + 100).toBe(bar.x + bar.w / 2);
    expect(anchorPoint(bar)).toEqual({ x: bar.x + bar.w / 2, y: bar.y });
  });
});

describe("placeMenu", () => {
  it("stays on screen and opens away from the dock", () => {
    const size = { w: 220, h: 180 };
    const bottom = placeMenu({ x: 760, y: 820 }, size, VIEWPORT);
    expect(bottom.y + size.h).toBe(820);
    const corner = placeMenu({ x: 2, y: 2 }, size, VIEWPORT);
    expect(corner).toEqual({ x: SCREEN_MARGIN, y: SCREEN_MARGIN });
  });
});

describe("previewLayout", () => {
  it("lays thumbnails side by side", () => {
    const row = previewLayout(3);
    expect(row.well.w).toBe(3 * PREVIEW.slotW + 2 * PREVIEW.slotGap);
    expect(row.well.h).toBe(PREVIEW.slotH);
  });
  it("shows thumbnails for the first few windows only but lists the titles", () => {
    const many = previewLayout(9);
    expect(many.shown).toBe(PREVIEW.maxSlots);
    expect(many.h).toBeGreaterThan(previewLayout(1).h);
  });
});

describe("the device-pixel grid", () => {
  it("puts every bar size and item length on whole device pixels at 100, 125 and 150 %", async () => {
    const { metricsFor: m, lengthOf: len, LENGTH_RATIO: ratios } = await import("./geometry");
    for (const dpr of [1, 1.25, 1.5]) {
      for (const icon of [36, 45, 48, 57, 64]) {
        const x = m(icon, dpr);
        for (const v of [x.icon, x.gap, x.pad, x.bar, x.edge]) expect(Math.abs(v * dpr - Math.round(v * dpr))).toBeLessThan(1e-9);
        for (const kind of Object.keys(ratios) as (keyof typeof ratios)[]) {
          const l = len(kind, x.icon, dpr);
          expect(Math.abs(l * dpr - Math.round(l * dpr))).toBeLessThan(1e-9);
        }
      }
    }
  });
});

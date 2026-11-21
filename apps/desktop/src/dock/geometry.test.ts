import { describe, expect, it } from "vitest";
import {
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
    expect(fitIconSize(48, kinds, 4000, false)).toBe(48);
  });
  it("shrinks until the row fits, but not below the minimum", () => {
    const fitted = fitIconSize(64, kinds, 900, false);
    expect(fitted).toBeLessThan(64);
    expect(rowLength(kinds, fitted, false)).toBeLessThanOrEqual(900);
    expect(fitIconSize(64, kinds, 50, false)).toBe(ICON_LIMITS.min);
  });
  it("measures a vertical dock along its height", () => {
    const withTile: LengthKind[] = ["item", "clock"];
    expect(rowLength(withTile, 48, true)).toBeLessThan(rowLength(withTile, 48, false));
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
    const p = placeBesideDock(anchor, size, "bottom", VIEWPORT, 20);
    expect(p.y + size.h).toBe(anchor.y - 20);
    expect(p.x + size.w / 2).toBe(anchor.x + anchor.w / 2);
  });
  it("keeps the panel on screen when the tile is near a corner", () => {
    const p = placeBesideDock({ ...anchor, x: 4 }, size, "bottom", VIEWPORT, 20);
    expect(p.x).toBe(SCREEN_MARGIN);
    const q = placeBesideDock({ ...anchor, x: 1530 }, size, "bottom", VIEWPORT, 20);
    expect(q.x + size.w).toBe(VIEWPORT.w - SCREEN_MARGIN);
  });
  it("opens towards the middle of the screen on every edge", () => {
    const left = placeBesideDock({ x: 10, y: 400, w: 48, h: 48 }, size, "left", VIEWPORT, 20);
    expect(left.x).toBe(10 + 48 + 20);
    const right = placeBesideDock({ x: 1470, y: 400, w: 48, h: 48 }, size, "right", VIEWPORT, 20);
    expect(right.x + size.w).toBe(1470 - 20);
    const top = placeBesideDock({ x: 700, y: 10, w: 48, h: 48 }, size, "top", VIEWPORT, 20);
    expect(top.y).toBe(10 + 48 + 20);
  });
});

describe("placeMenu", () => {
  it("stays on screen and opens away from the dock", () => {
    const size = { w: 220, h: 180 };
    const bottom = placeMenu({ x: 760, y: 820 }, size, "bottom", VIEWPORT);
    expect(bottom.y + size.h).toBe(820);
    const corner = placeMenu({ x: 2, y: 2 }, size, "top", VIEWPORT);
    expect(corner).toEqual({ x: SCREEN_MARGIN, y: SCREEN_MARGIN });
  });
});

describe("previewLayout", () => {
  it("lays thumbnails side by side on a horizontal dock and stacks them on a vertical one", () => {
    const row = previewLayout(3, false);
    const column = previewLayout(3, true);
    expect(row.well.w).toBe(3 * PREVIEW.slotW + 2 * PREVIEW.slotGap);
    expect(row.well.h).toBe(PREVIEW.slotH);
    expect(column.well.w).toBe(PREVIEW.slotW);
    expect(column.well.h).toBe(3 * PREVIEW.slotH + 2 * PREVIEW.slotGap);
  });
  it("shows thumbnails for the first few windows only but lists the titles", () => {
    const many = previewLayout(9, false);
    expect(many.shown).toBe(PREVIEW.maxSlots);
    expect(many.h).toBeGreaterThan(previewLayout(1, false).h);
    expect(many.titles).toBe(PREVIEW.maxRows);
    expect(many.more).toBe(9 - PREVIEW.maxRows);
  });
  it("counts the last 'and N more' row in its height", () => {
    expect(previewLayout(PREVIEW.maxRows + 1, false).h - previewLayout(PREVIEW.maxRows, false).h).toBe(PREVIEW.row);
  });
  it("drops thumbnails, then titles, until it fits a small screen", () => {
    const room = { w: 1280, h: 720 };
    const column = previewLayout(9, true, room);
    expect(column.shown).toBeLessThan(PREVIEW.maxSlots);
    expect(column.h).toBeLessThanOrEqual(room.h - 2 * SCREEN_MARGIN);
    expect(previewLayout(9, true, { w: 1920, h: 1080 }).shown).toBe(PREVIEW.maxSlots);
    const tiny = previewLayout(9, true, { w: 400, h: 300 });
    expect(tiny.shown).toBe(1);
    expect(tiny.titles + tiny.more).toBe(9);
  });
});

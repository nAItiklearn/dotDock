import { describe, expect, it } from "vitest";
import {
  anchorPoint,
  contains,
  EDIT_BANNER,
  GALLERY,
  HIT_MARGIN,
  ICON_LIMITS,
  inflate,
  MENU,
  metricsFor,
  placeBesideDock,
  placeMenu,
  popoverSize,
  POPOVER,
  PREFS,
  previewLayout,
  TILE_POPOVER,
  TILE_POPOVER_SIZE,
  type Point,
  type Rect,
  type Size,
} from "./geometry";
import { menuFor, menuSize, type MenuContext } from "./menu";
import type { DockApp, DockSettings } from "./protocol";
import { computeRegions, coversWindow, dockZone, pointerMode, snapRect, type OpenState, type RegionInput } from "./regions";

// Every state the dock can be in (it lives at the bottom only, D-029), placed with the same functions the panels use to draw themselves, at the CSS
// viewports of a 1920 x 1080 monitor at 100, 125 and 150 % scale. The incident of 2026-11-21 was one of these
// states (any open menu) taking the whole monitor; these tests fail if any state but the App Library ever does.

const VIEWPORTS: readonly Size[] = [
  { w: 1920, h: 1080 },
  { w: 1536, h: 864 },
  { w: 1280, h: 720 },
];
const ICON = ICON_LIMITS.fallback;
const BAR_LENGTH = 720;
const HEADROOM = 34;
const GROWTH = 80;
const PREVIEW_GAP = 10;

function barFor(viewport: Size): Rect {
  const m = metricsFor(ICON);
  return { x: (viewport.w - BAR_LENGTH) / 2, y: viewport.h - m.edge - m.bar, w: BAR_LENGTH, h: m.bar };
}

/** The first cell on the bar, where a menu, a stack or a tile popover opens from. */
function firstCell(bar: Rect): Rect {
  const m = metricsFor(ICON);
  return { x: bar.x + m.pad, y: bar.y + m.pad, w: ICON, h: ICON };
}

const app = (id: string): DockApp => ({ id, name: id, category: "development", filedBy: "known", icon: "", publisher: null, firstSeen: 0 });
const settings: DockSettings = {
  schema: 1,
  enabled: true,
  replaceTaskbar: false,
  edge: "bottom",
  reserveSpace: true,
  autoHide: false,
  iconSize: ICON,
  magnification: 1.25,
  pinned: [{ kind: "app", id: "code" }],
  tiles: ["clock"],
};
const noop = (): void => undefined;
const ctx: MenuContext = {
  settings,
  categories: [{ id: "development", name: null, tone: "blue", order: 0 }],
  apps: [app("code")],
  windows: [{ hwnd: "1", appId: "code", title: "main.rs", icon: "", minimized: false, focused: true, flashing: false }],
  editing: false,
  do: { launch: noop, closeWindows: noop, setCategory: noop, updateSettings: noop, openStack: noop, setLibrary: noop, setEditing: noop, openGallery: noop, openSettings: noop },
};

const at = (p: Point, size: Size): Rect => ({ x: p.x, y: p.y, w: size.w, h: size.h });

/** Every popover, menu, preview and banner the dock can draw, by name, for one viewport. */
function panels(viewport: Size): Map<string, Rect> {
  const bar = barFor(viewport);
  const cell = firstCell(bar);
  const out = new Map<string, Rect>();
  const m = metricsFor(ICON);
  const itemGap = m.pad + MENU.gap * 2;
  out.set("menu: the bar", at(placeMenu({ x: bar.x + bar.w / 2, y: bar.y }, menuSize(menuFor(null, ctx)), viewport, MENU.gap), menuSize(menuFor(null, ctx))));
  out.set("menu: an app", at(placeMenu(anchorPoint(cell), menuSize(menuFor("app:code", ctx)), viewport, itemGap), menuSize(menuFor("app:code", ctx))));
  out.set("menu: a stack", at(placeMenu(anchorPoint(cell), menuSize(menuFor("stack:development", ctx)), viewport, itemGap), menuSize(menuFor("stack:development", ctx))));
  out.set("menu: a tile", at(placeMenu(anchorPoint(cell), menuSize(menuFor("tile:clock", ctx)), viewport, itemGap), menuSize(menuFor("tile:clock", ctx))));
  for (const count of [1, 4, 9, 16, 20, 40]) {
    const size = popoverSize(count);
    out.set(`stack of ${count}`, at(placeBesideDock(cell, size, viewport, POPOVER.gap), size));
  }
  for (const [id, size] of Object.entries(TILE_POPOVER_SIZE)) out.set(`tile popover: ${id}`, at(placeBesideDock(cell, size, viewport, TILE_POPOVER.gap), size));
  out.set("widget gallery", at(placeBesideDock(bar, GALLERY, viewport, GALLERY.gapToDock), GALLERY));
  out.set("customise panel", at(placeBesideDock(bar, PREFS, viewport, PREFS.gapToDock), PREFS));
  for (const windows of [1, 2, 4, 6, 9]) {
    const layout = previewLayout(windows, viewport);
    out.set(`preview of ${windows} windows`, at(placeBesideDock(cell, layout, viewport, PREVIEW_GAP), layout));
  }
  out.set("edit banner", at(placeBesideDock(bar, EDIT_BANNER, viewport, HEADROOM + EDIT_BANNER.gap), EDIT_BANNER));
  return out;
}

const input = (viewport: Size, extra: Partial<RegionInput> = {}): RegionInput => ({
  bar: barFor(viewport),
  engaged: false,
  headroom: HEADROOM,
  growth: GROWTH,
  hidden: false,
  autoHide: false,
  panels: [],
  fullscreen: false,
  viewport,
  ...extra,
});

const inAny = (rects: readonly Rect[], p: Point): boolean => rects.some((r) => contains(r, p));

/** Points on a 24 px grid over the whole window. */
function grid(viewport: Size): Point[] {
  const points: Point[] = [];
  for (let y = 2; y < viewport.h; y += 24) for (let x = 2; x < viewport.w; x += 24) points.push({ x, y });
  return points;
}

describe("hit regions in every state of the dock", () => {
  for (const viewport of VIEWPORTS) {
    for (const [name, panel] of panels(viewport)) {
      for (const engaged of [false, true]) {
        it(`${name}, ${viewport.w} x ${viewport.h}, pointer ${engaged ? "on" : "off"} the bar`, () => {
          const regions = computeRegions(input(viewport, { engaged, panels: [snapRect(panel)] })).map(snapRect);
          // Nothing but the App Library may take the whole window.
          for (const r of regions) expect(coversWindow(r, viewport)).toBe(false);
          // The panel is on screen and every point of it takes the pointer, so it can be used.
          expect(panel.x).toBeGreaterThanOrEqual(0);
          expect(panel.y).toBeGreaterThanOrEqual(0);
          expect(panel.x + panel.w).toBeLessThanOrEqual(viewport.w);
          expect(panel.y + panel.h).toBeLessThanOrEqual(viewport.h);
          for (const corner of [
            { x: panel.x, y: panel.y },
            { x: panel.x + panel.w, y: panel.y + panel.h },
            { x: panel.x + panel.w / 2, y: panel.y + panel.h / 2 },
          ])
            expect(inAny(regions, corner)).toBe(true);
          // Every point the pointer is taken at is drawn: the bar's zone or the panel, within the hit margin.
          const drawn = [inflate(dockZone(input(viewport, { engaged })), 1), inflate(panel, HIT_MARGIN + 1)];
          const points = grid(viewport);
          let through = 0;
          for (const p of points) {
            if (!inAny(regions, p)) through++;
            else expect(inAny(drawn, p)).toBe(true);
          }
          // Most of the desktop always clicks through.
          expect(through / points.length).toBeGreaterThan(0.5);
        });
      }
    }

    it(`auto-hidden, ${viewport.w} x ${viewport.h}: only a thin strip on the screen edge`, () => {
      const regions = computeRegions(input(viewport, { hidden: true }));
      expect(regions).toHaveLength(1);
      const [strip] = regions as [Rect];
      expect(Math.min(strip.w, strip.h)).toBeLessThanOrEqual(4);
    });

    it(`the App Library, ${viewport.w} x ${viewport.h}: the whole window, because it is drawn over all of it`, () => {
      expect(computeRegions(input(viewport, { fullscreen: true }))).toEqual([{ x: 0, y: 0, w: viewport.w, h: viewport.h }]);
    });
  }
});

describe("pointer mode for every combination of open things", () => {
  const keys = ["libraryOpen", "stack", "tile", "gallery", "prefs", "menu", "editing"] as const;
  for (let mask = 0; mask < 1 << keys.length; mask++) {
    const on = (k: (typeof keys)[number]): boolean => (mask & (1 << keys.indexOf(k))) !== 0;
    const state: OpenState = {
      libraryOpen: on("libraryOpen"),
      stack: on("stack") ? { category: "development" } : null,
      tile: on("tile") ? { id: "system" } : null,
      gallery: on("gallery") ? {} : null,
      prefs: on("prefs") ? {} : null,
      menu: on("menu") ? { key: null } : null,
      editing: on("editing"),
    };
    const label = keys.filter(on).join(" + ") || "nothing open";
    it(label, () => {
      const mode = pointerMode(state);
      expect(mode.fullscreen).toBe(state.libraryOpen);
      expect(mode.panelOpen).toBe(keys.some((k) => k !== "editing" && on(k)));
      // The dock only ever asks for the keyboard after the user opened something on it.
      expect(mode.keyboard).toBe(mask !== 0);
    });
  }
});

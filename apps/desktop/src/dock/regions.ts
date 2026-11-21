import { HIT_MARGIN, inflate, isVertical, type Rect, type Size } from "./geometry";
import type { DockEdge } from "./protocol";

/** Thickness of the strip that wakes an auto-hidden dock, in px. */
export const HOT_ZONE = 4;

/** `rect` grown by `amount` towards the middle of the screen, the side magnified items grow into. */
export function towardInside(rect: Rect, edge: DockEdge, amount: number): Rect {
  switch (edge) {
    case "bottom":
      return { ...rect, y: rect.y - amount, h: rect.h + amount };
    case "top":
      return { ...rect, h: rect.h + amount };
    case "left":
      return { ...rect, w: rect.w + amount };
    case "right":
      return { ...rect, x: rect.x - amount, w: rect.w + amount };
  }
}

/** `rect` grown by `amount` at both ends of the dock's axis. */
export function alongAxis(rect: Rect, edge: DockEdge, amount: number): Rect {
  return isVertical(edge)
    ? { ...rect, y: rect.y - amount, h: rect.h + 2 * amount }
    : { ...rect, x: rect.x - amount, w: rect.w + 2 * amount };
}

export interface RegionInput {
  /** The bar at rest, in window CSS px. */
  readonly bar: Rect;
  readonly edge: DockEdge;
  /** Magnified items are drawn above the bar: the pointer is still "on the dock" up there. */
  readonly engaged: boolean;
  readonly headroom: number;
  /** Most the row can grow along its axis when magnified. */
  readonly growth: number;
  readonly hidden: boolean;
  /** Popovers, menus and previews that take the pointer: each as drawn, never the empty space around it. */
  readonly panels: readonly Rect[];
  /**
   * The App Library is open. It is drawn over the whole screen, so the whole window takes the pointer. Nothing else
   * ever does: a click beside an open popover goes to the app under it, and the dock closes the popover when its
   * window loses focus.
   */
  readonly fullscreen: boolean;
  readonly viewport: Size;
}

/** The area the dock needs the pointer in right now, as a single rect (before panels are added). */
export function dockZone(input: Pick<RegionInput, "bar" | "edge" | "engaged" | "headroom" | "growth">): Rect {
  const { bar, edge, engaged, headroom, growth } = input;
  const base = inflate(bar, HIT_MARGIN);
  return engaged ? towardInside(alongAxis(base, edge, growth), edge, headroom) : base;
}

/** A thin strip along the screen edge, where the pointer wakes a hidden dock. */
export function hotStrip(bar: Rect, edge: DockEdge, viewport: Size): Rect {
  switch (edge) {
    case "bottom":
      return { x: bar.x, y: viewport.h - HOT_ZONE, w: bar.w, h: HOT_ZONE };
    case "top":
      return { x: bar.x, y: 0, w: bar.w, h: HOT_ZONE };
    case "left":
      return { x: 0, y: bar.y, w: HOT_ZONE, h: bar.h };
    case "right":
      return { x: viewport.w - HOT_ZONE, y: bar.y, w: HOT_ZONE, h: bar.h };
  }
}

/** Rectangles for `dock_set_regions`: everything that must take the pointer, nothing else. */
export function computeRegions(input: RegionInput): Rect[] {
  if (input.fullscreen) return [{ x: 0, y: 0, w: input.viewport.w, h: input.viewport.h }];
  const dock = input.hidden ? hotStrip(input.bar, input.edge, input.viewport) : dockZone(input);
  return [dock, ...input.panels.map((p) => inflate(p, HIT_MARGIN))];
}

const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export function sameRegions(a: readonly Rect[], b: readonly Rect[]): boolean {
  return a.length === b.length && a.every((rect, i) => sameRect(rect, b[i] as Rect));
}

/** Rounds to whole CSS px so sub-pixel layout noise never counts as a change. */
export const snapRect = (r: Rect): Rect => ({ x: Math.floor(r.x), y: Math.floor(r.y), w: Math.ceil(r.w), h: Math.ceil(r.h) });

/** Whether a rect covers (nearly) the whole window: only the App Library may ask for that. */
export const coversWindow = (rect: Rect, viewport: Size): boolean => rect.w >= viewport.w && rect.h >= viewport.h;

interface Measurable {
  getBoundingClientRect(): { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
}

/** The drawn boxes of the open panels, skipping anything with no size (a panel mounted but not shown). */
export function measurePanels(elements: Iterable<Measurable>): Rect[] {
  const rects: Rect[] = [];
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  }
  return rects;
}

/** What marks a shown panel in the dock window: popovers that are open, and context menus. */
export const OPEN_PANEL_SELECTOR = '.popover[data-open="true"], .menu';

/** What is open on the dock, as far as the pointer and the keyboard are concerned. */
export interface OpenState {
  readonly libraryOpen: boolean;
  readonly stack: unknown;
  readonly tile: unknown;
  readonly gallery: unknown;
  readonly prefs: unknown;
  readonly menu: unknown;
  readonly editing: boolean;
}

export interface PointerMode {
  /** A popover or menu is open: its drawn box is measured into the hit regions, and it closes on blur. */
  readonly panelOpen: boolean;
  /** The whole window takes the pointer. True only for the App Library. */
  readonly fullscreen: boolean;
  /** The dock asks for the keyboard. Only ever after the user opened something on the dock itself. */
  readonly keyboard: boolean;
}

/** How the dock window treats the pointer and the keyboard for what is open right now. */
export function pointerMode(open: OpenState): PointerMode {
  const panelOpen =
    open.libraryOpen || open.stack !== null || open.tile !== null || open.gallery !== null || open.prefs !== null || open.menu !== null;
  return { panelOpen, fullscreen: open.libraryOpen, keyboard: open.editing || panelOpen };
}

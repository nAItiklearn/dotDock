import { HIT_MARGIN, inflate, type Rect, type Size } from "./geometry";

/** Thickness of the strip along the bottom of the screen that wakes an auto-hidden dock, in px. */
export const HOT_ZONE = 4;

/** `rect` grown by `amount` upwards, the side magnified items grow into. */
export const towardInside = (rect: Rect, amount: number): Rect => ({ ...rect, y: rect.y - amount, h: rect.h + amount });

/** `rect` grown by `amount` at both ends of the row. */
export const alongAxis = (rect: Rect, amount: number): Rect => ({ ...rect, x: rect.x - amount, w: rect.w + 2 * amount });

export interface RegionInput {
  /** The bar at rest, in window CSS px. */
  readonly bar: Rect;
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
export function dockZone(input: Pick<RegionInput, "bar" | "engaged" | "headroom" | "growth">): Rect {
  const { bar, engaged, headroom, growth } = input;
  const base = inflate(bar, HIT_MARGIN);
  return engaged ? towardInside(alongAxis(base, growth), headroom) : base;
}

/** A thin strip along the bottom of the screen under the bar, where the pointer wakes a hidden dock. */
export const hotStrip = (bar: Rect, viewport: Size): Rect => ({ x: bar.x, y: viewport.h - HOT_ZONE, w: bar.w, h: HOT_ZONE });

/** Rectangles for `dock_set_regions`: everything that must take the pointer, nothing else. */
export function computeRegions(input: RegionInput): Rect[] {
  if (input.fullscreen) return [{ x: 0, y: 0, w: input.viewport.w, h: input.viewport.h }];
  const dock = input.hidden ? hotStrip(input.bar, input.viewport) : dockZone(input);
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

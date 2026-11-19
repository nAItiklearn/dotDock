import type { DockEdge } from "./protocol";

/**
 * Dock layout, in px at 100 % scaling. Every size on screen derives from the icon size and these named
 * ratios: the TypeScript side sets them as CSS custom properties, the stylesheet never repeats them.
 */
export const ICON_LIMITS = { min: 32, max: 80, fallback: 48 } as const;
export const MAGNIFICATION_LIMITS = { min: 1, max: 2.4 } as const;

/** Ratios of the icon size, so one number scales the whole bar. */
export const RATIO = {
  gap: 0.14,
  pad: 0.17,
  /** The dotted divider's slot along the axis. */
  divider: 0.3,
  /** Distance from the pointer at which magnification fades out, in item pitches (icon + gap). */
  reach: 2.4,
  /** Art inside an item's disc. */
  face: 0.66,
  /** Gap between the dock and the screen edge. */
  edge: 0.2,
  /** Cross-axis size of the status capsule. */
  statusCross: 0.78,
  /** Room left above the magnified items for their name label. */
  label: 0.5,
} as const;

/** Length of each kind of item along the axis, in icon sizes: [horizontal dock, vertical dock]. */
export const LENGTH_RATIO = {
  item: [1, 1],
  divider: [RATIO.divider, RATIO.divider],
  clock: [2.3, 1.55],
  media: [3.8, 1],
  system: [1.05, 1.05],
  /** Measured once drawn; this estimate only sizes the dock before the first measurement. */
  status: [3.2, 2.3],
} as const;
export type LengthKind = keyof typeof LENGTH_RATIO;

export interface Metrics {
  readonly icon: number;
  readonly gap: number;
  readonly pad: number;
  /** Thickness of the bar across the axis. */
  readonly bar: number;
  readonly edge: number;
  /** Radius of the pointer's influence on magnification. */
  readonly reach: number;
}

export function clampIconSize(size: number): number {
  if (!Number.isFinite(size)) return ICON_LIMITS.fallback;
  return Math.min(ICON_LIMITS.max, Math.max(ICON_LIMITS.min, size));
}

export function clampMagnification(peak: number): number {
  if (!Number.isFinite(peak)) return MAGNIFICATION_LIMITS.min;
  return Math.min(MAGNIFICATION_LIMITS.max, Math.max(MAGNIFICATION_LIMITS.min, peak));
}

export function metricsFor(iconSize: number): Metrics {
  const icon = Math.round(clampIconSize(iconSize));
  const gap = Math.round(icon * RATIO.gap);
  const pad = Math.round(icon * RATIO.pad);
  return { icon, gap, pad, bar: icon + 2 * pad, edge: Math.round(icon * RATIO.edge), reach: RATIO.reach * (icon + gap) };
}

export const isVertical = (edge: DockEdge): boolean => edge === "left" || edge === "right";

/** Length of one item along the axis at a given icon size. */
export function lengthOf(kind: LengthKind, icon: number, vertical: boolean): number {
  return LENGTH_RATIO[kind][vertical ? 1 : 0] * icon;
}

/** Total length of a row of items at the given icon size, gaps and padding included. */
export function rowLength(kinds: readonly LengthKind[], icon: number, vertical: boolean): number {
  const m = metricsFor(icon);
  const items = kinds.reduce((sum, kind) => sum + lengthOf(kind, m.icon, vertical), 0);
  return items + Math.max(0, kinds.length - 1) * m.gap + 2 * m.pad;
}

/**
 * The icon size the dock actually uses: the requested one, shrunk until the row fits the screen along its
 * axis (like macOS does), never below the minimum.
 */
export function fitIconSize(requested: number, kinds: readonly LengthKind[], available: number, vertical: boolean): number {
  const wanted = Math.round(clampIconSize(requested));
  if (kinds.length === 0 || available <= 0) return wanted;
  // The row length is linear in the icon size (up to rounding), so one probe gives the whole slope.
  const perIcon = rowLength(kinds, ICON_LIMITS.max, vertical) / ICON_LIMITS.max;
  const fits = Math.floor(available / perIcon);
  return Math.max(ICON_LIMITS.min, Math.min(wanted, fits));
}

/** Popover over a stack, in px. */
export const POPOVER = {
  cellW: 92,
  cellH: 100,
  face: 56,
  pad: 16,
  header: 58,
  cellGap: 4,
  maxRows: 4,
  minCols: 3,
  maxCols: 5,
  /** Space between the popover and the bar, beyond the room magnified items need. */
  gap: 12,
} as const;

export interface GridSize {
  readonly cols: number;
  readonly rows: number;
  readonly w: number;
  readonly h: number;
  /** More rows than fit: the grid scrolls inside the popover. */
  readonly scrolls: boolean;
}

/** Columns that make the grid close to square, within the popover's limits. */
export function gridColumns(count: number): number {
  return Math.min(POPOVER.maxCols, Math.max(POPOVER.minCols, Math.ceil(Math.sqrt(Math.max(count, 1)))));
}

export function popoverSize(count: number): GridSize {
  const cols = gridColumns(count);
  const rows = Math.max(1, Math.ceil(count / cols));
  const shownRows = Math.min(rows, POPOVER.maxRows);
  return {
    cols,
    rows,
    w: cols * POPOVER.cellW + (cols - 1) * POPOVER.cellGap + 2 * POPOVER.pad,
    h: POPOVER.header + shownRows * POPOVER.cellH + (shownRows - 1) * POPOVER.cellGap + POPOVER.pad,
    scrolls: rows > POPOVER.maxRows,
  };
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Size {
  readonly w: number;
  readonly h: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Margin kept between floating panels and the screen edge. */
export const SCREEN_MARGIN = 12;

/**
 * Where a floating panel sits next to the dock: on the side away from the screen edge, centred on the
 * anchor, nudged to stay on screen.
 */
export function placeBesideDock(anchor: Rect, size: Size, edge: DockEdge, viewport: Size, gap: number): Point {
  const clamp = (value: number, extent: number, limit: number): number =>
    Math.max(SCREEN_MARGIN, Math.min(value, limit - SCREEN_MARGIN - extent));
  switch (edge) {
    case "bottom":
      return { x: clamp(anchor.x + anchor.w / 2 - size.w / 2, size.w, viewport.w), y: anchor.y - gap - size.h };
    case "top":
      return { x: clamp(anchor.x + anchor.w / 2 - size.w / 2, size.w, viewport.w), y: anchor.y + anchor.h + gap };
    case "left":
      return { x: anchor.x + anchor.w + gap, y: clamp(anchor.y + anchor.h / 2 - size.h / 2, size.h, viewport.h) };
    case "right":
      return { x: anchor.x - gap - size.w, y: clamp(anchor.y + anchor.h / 2 - size.h / 2, size.h, viewport.h) };
  }
}

/** The side a context menu opens towards when it is anchored at a point: away from the dock. */
export function placeMenu(at: Point, size: Size, edge: DockEdge, viewport: Size): Point {
  const x = isVertical(edge) ? (edge === "left" ? at.x : at.x - size.w) : at.x - size.w / 2;
  const y = isVertical(edge) ? at.y - size.h / 2 : edge === "bottom" ? at.y - size.h : at.y;
  return {
    x: Math.max(SCREEN_MARGIN, Math.min(x, viewport.w - SCREEN_MARGIN - size.w)),
    y: Math.max(SCREEN_MARGIN, Math.min(y, viewport.h - SCREEN_MARGIN - size.h)),
  };
}

/** Window thumbnails shown on hover. Each slot is where the core draws one live thumbnail. */
export const PREVIEW = {
  slotW: 200,
  slotH: 126,
  slotGap: 10,
  pad: 12,
  maxSlots: 4,
  row: 30,
  maxRows: 6,
} as const;

export interface PreviewLayout {
  /** Size of the whole panel. */
  readonly w: number;
  readonly h: number;
  /** Where the core draws the thumbnails, relative to the panel's top-left. */
  readonly well: Rect;
  readonly shown: number;
}

/** Layout of the preview panel for a number of windows: thumbnails for the first few, titles for all. */
export function previewLayout(windowCount: number, vertical: boolean): PreviewLayout {
  const shown = Math.min(windowCount, PREVIEW.maxSlots);
  const cols = vertical ? 1 : shown;
  const rows = vertical ? shown : 1;
  const wellW = cols * PREVIEW.slotW + (cols - 1) * PREVIEW.slotGap;
  const wellH = rows * PREVIEW.slotH + (rows - 1) * PREVIEW.slotGap;
  const titles = Math.min(windowCount, PREVIEW.maxRows);
  return {
    w: wellW + 2 * PREVIEW.pad,
    h: PREVIEW.pad + wellH + PREVIEW.pad / 2 + titles * PREVIEW.row + PREVIEW.pad / 2,
    well: { x: PREVIEW.pad, y: PREVIEW.pad, w: wellW, h: wellH },
    shown,
  };
}

/** Margin around a rect that still counts as being on it, so the edge never flickers. */
export const HIT_MARGIN = 6;

export const inflate = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });

export const contains = (r: Rect, p: Point): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

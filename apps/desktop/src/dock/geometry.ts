/**
 * Dock layout, in px at 100 % scaling. Every size on screen derives from the icon size and these named
 * ratios: the TypeScript side sets them as CSS custom properties, the stylesheet never repeats them.
 */
export const ICON_LIMITS = { min: 32, max: 80, fallback: 48 } as const;
export const MAGNIFICATION_LIMITS = { min: 1, max: 1.6, fallback: 1.25 } as const;

/** How much of the magnification each kind of item takes: apps grow fully, stacks a little, controls in between. */
export const MAGNIFY_WEIGHT = { app: 1, stack: 0.3, control: 0.6 } as const;

/** How large a face is drawn, in icon sizes: its peak, so magnifying only ever scales it down from there. */
export const renderScale = (weight: number, peak: number): number => 1 + (Math.max(peak, 1) - 1) * weight;

/**
 * The box of a face inside its slot: `along` px wide and `across` px tall, standing on the slot's bottom (the
 * screen edge) and centred across it. Plain numbers (px): nothing in it needs resolving again when the engine
 * rewrites the face's transform.
 */
export interface FaceBox {
  readonly width: number;
  readonly height: number;
  readonly left: string;
  readonly bottom: number;
  readonly marginLeft: number;
}

export function faceBox(along: number, across: number): FaceBox {
  return { width: along, height: across, left: "50%", marginLeft: -along / 2, bottom: 0 };
}

/** Ratios of the icon size, so one number scales the whole bar. */
export const RATIO = {
  gap: 0.14,
  pad: 0.17,
  /** The dotted divider's slot along the axis. */
  divider: 0.3,
  /** Distance from the pointer at which magnification fades out, in item pitches (icon + gap). */
  reach: 1.5,
  /** Art inside an item's disc. */
  face: 0.66,
  /** Gap between the dock and the screen edge. */
  edge: 0.2,
  /** Cross-axis size of the status capsule. */
  statusCross: 0.78,
  /** Room left above the magnified items for their name label. */
  label: 0.5,
} as const;

/** Length of each kind of item along the dock, in icon sizes. */
export const LENGTH_RATIO = {
  item: 1,
  divider: RATIO.divider,
  clock: 2.3,
  media: 3.8,
  system: 1.05,
  agenda: 3.6,
  meeting: 3.9,
  focus: 2.8,
  stopwatch: 2.6,
  hydration: 1,
  reminders: 3.1,
  progress: 2.5,
  contacts: 2.1,
  mic: 1,
  audio: 1,
  cpu: 1,
  battery: 1,
  analog: 1,
  notes: 3.1,
  colour: 1,
  convert: 2.8,
  emoji: 1,
  world: 3.1,
  network: 3.2,
  toggles: 3.4,
  flip: 2.2,
  sun: 3.8,
  wind: 2.7,
  weather: 2.7,
  currency: 3.6,
  search: 2.8,
  history: 3.1,
  memo: 2.8,
  /** Measured once drawn; this estimate only sizes the dock before the first measurement. */
  status: 3.2,
} as const;
export type LengthKind = keyof typeof LENGTH_RATIO;

/** How a tile sits on the dock: a round mark alone, or a mark with words beside it. */
export type TileShape = "round" | "wide";

/** Length, in icon sizes, past which a tile is clearly longer than it is tall. */
const WIDE_FROM = 1.2;

/** A tile is wide when it is clearly longer than it is tall. */
export const shapeOf = (kind: LengthKind): TileShape => (LENGTH_RATIO[kind] > WIDE_FROM ? "wide" : "round");

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
  if (!Number.isFinite(peak)) return MAGNIFICATION_LIMITS.fallback;
  return Math.min(MAGNIFICATION_LIMITS.max, Math.max(MAGNIFICATION_LIMITS.min, peak));
}

/**
 * A length in CSS px moved to the nearest whole device pixel. At 125 % one CSS px is 1.25 device px, so a whole CSS
 * px is not always a whole device pixel; every length the dock lays out goes through this so no edge is resampled.
 */
export const toDevicePixel = (css: number, dpr = 1): number => (dpr > 0 ? Math.round(css * dpr) / dpr : Math.round(css));

/** The bar's sizes, each on the device-pixel grid of a screen at `dpr` (window.devicePixelRatio). */
export function metricsFor(iconSize: number, dpr = 1): Metrics {
  const base = Math.round(clampIconSize(iconSize));
  const icon = toDevicePixel(base, dpr);
  const gap = toDevicePixel(base * RATIO.gap, dpr);
  const pad = toDevicePixel(base * RATIO.pad, dpr);
  return { icon, gap, pad, bar: icon + 2 * pad, edge: toDevicePixel(base * RATIO.edge, dpr), reach: RATIO.reach * (icon + gap) };
}

/** Length of one item along the dock at a given icon size. */
export function lengthOf(kind: LengthKind, icon: number, dpr = 1): number {
  return toDevicePixel(LENGTH_RATIO[kind] * icon, dpr);
}

/** Total length of a row of items at the given icon size, gaps and padding included. */
export function rowLength(kinds: readonly LengthKind[], icon: number): number {
  const m = metricsFor(icon);
  const items = kinds.reduce((sum, kind) => sum + lengthOf(kind, m.icon), 0);
  return items + Math.max(0, kinds.length - 1) * m.gap + 2 * m.pad;
}

/**
 * The icon size the dock actually uses: the requested one, shrunk until the row fits the screen's width (like
 * macOS does), never below the minimum.
 */
export function fitIconSize(requested: number, kinds: readonly LengthKind[], available: number): number {
  const wanted = Math.round(clampIconSize(requested));
  if (kinds.length === 0 || available <= 0) return wanted;
  // The row length is linear in the icon size (up to rounding), so one probe gives the whole slope.
  const perIcon = rowLength(kinds, ICON_LIMITS.max) / ICON_LIMITS.max;
  const fits = Math.floor(available / perIcon);
  return Math.max(ICON_LIMITS.min, Math.min(wanted, fits));
}

/** Popover over a stack, in px. */
export const POPOVER = {
  cellW: 92,
  cellH: 108,
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
 * Where a floating panel sits next to the dock: above it, centred on the anchor, nudged sideways to stay on
 * screen.
 */
export function placeBesideDock(anchor: Rect, size: Size, viewport: Size, gap: number): Point {
  const x = anchor.x + anchor.w / 2 - size.w / 2;
  return { x: Math.max(SCREEN_MARGIN, Math.min(x, viewport.w - SCREEN_MARGIN - size.w)), y: anchor.y - gap - size.h };
}

/** The point on a drawn item that faces the middle of the screen (the middle of its top): where menus attach. */
export function anchorPoint(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y };
}

/** Where a context menu opens when it is anchored at a point: above it, away from the dock. */
export function placeMenu(at: Point, size: Size, viewport: Size, gap = 0): Point {
  const x = at.x - size.w / 2;
  const y = at.y - size.h - gap;
  return {
    x: Math.max(SCREEN_MARGIN, Math.min(x, viewport.w - SCREEN_MARGIN - size.w)),
    y: Math.max(SCREEN_MARGIN, Math.min(y, viewport.h - SCREEN_MARGIN - size.h)),
  };
}

/** The strip shown above the dock while it is edited, in px. */
export const EDIT_BANNER = { w: 440, h: 52, gap: 10 } as const;

/** The App Library's grid, in px. */
export const LIBRARY = { cellW: 112, cellH: 120, face: 64, gap: 8, maxWidth: 1240, pad: 32 } as const;

/** Columns that fit in `width` px of grid, at least one. */
export function libraryColumns(width: number): number {
  return Math.max(1, Math.floor((width + LIBRARY.gap) / (LIBRARY.cellW + LIBRARY.gap)));
}

/**
 * Popovers that open from a live tile, in px. Each tile's size is fixed so the popover can be placed before it is
 * laid out; a list inside scrolls when it outgrows its tile's room. Tiles not listed here (the clock, the media
 * player and the microphone) act on a press and have no popover.
 */
export const TILE_POPOVER = { pad: 16, head: 52, gap: 12 } as const;
export const TILE_POPOVER_SIZE = {
  system: { w: 320, h: 344 },
  agenda: { w: 340, h: 380 },
  meeting: { w: 340, h: 250 },
  focus: { w: 320, h: 320 },
  stopwatch: { w: 320, h: 400 },
  hydration: { w: 300, h: 340 },
  reminders: { w: 340, h: 420 },
  progress: { w: 340, h: 360 },
  contacts: { w: 340, h: 400 },
  audio: { w: 340, h: 380 },
  notes: { w: 380, h: 440 },
  colour: { w: 320, h: 340 },
  convert: { w: 340, h: 380 },
  emoji: { w: 340, h: 390 },
  world: { w: 340, h: 410 },
  network: { w: 340, h: 330 },
  toggles: { w: 330, h: 340 },
  sun: { w: 330, h: 330 },
  currency: { w: 360, h: 340 },
  search: { w: 380, h: 220 },
  history: { w: 320, h: 400 },
  memo: { w: 360, h: 380 },
} as const;
export type PopoverTileId = keyof typeof TILE_POPOVER_SIZE;
export const isPopoverTile = (id: string): id is PopoverTileId => Object.hasOwn(TILE_POPOVER_SIZE, id);

/** The widget gallery popover, in px: its size, and the icon size its live previews are drawn at. */
export const GALLERY = { w: 660, h: 560, pad: 16, head: 52, icon: 40, cardMin: 190, gap: 12, gapToDock: 12 } as const;

/** The dock settings popover, in px. */
export const PREFS = { w: 340, h: 600, pad: 16, head: 52, gapToDock: 12 } as const;

/** Context menus, in px. */
export const MENU = { w: 236, row: 34, heading: 30, separator: 9, pad: 6, gap: 4 } as const;

/** Window thumbnails shown on hover. Each slot is where the core draws one live thumbnail. */
export const PREVIEW = {
  header: 30,
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
  /** Windows with a thumbnail. */
  readonly shown: number;
  /** Windows listed by title. */
  readonly titles: number;
  /** Windows left out of the list, counted in a last "and N more" row. */
  readonly more: number;
}

function previewFor(windowCount: number, shown: number, titles: number): PreviewLayout {
  const wellW = shown * PREVIEW.slotW + (shown - 1) * PREVIEW.slotGap;
  const wellH = PREVIEW.slotH;
  const more = windowCount - titles;
  const listed = titles + (more > 0 ? 1 : 0);
  return {
    w: wellW + 2 * PREVIEW.pad,
    h: PREVIEW.pad + PREVIEW.header + wellH + PREVIEW.pad / 2 + listed * PREVIEW.row + PREVIEW.pad / 2,
    well: { x: PREVIEW.pad, y: PREVIEW.pad + PREVIEW.header, w: wellW, h: wellH },
    shown,
    titles,
    more,
  };
}

/**
 * Layout of the preview panel for a number of windows: thumbnails for the first few, titles for the rest. On a
 * small screen it drops thumbnails, then title rows, until the panel fits `room` inside the screen margin.
 */
export function previewLayout(windowCount: number, room?: Size): PreviewLayout {
  let shown = Math.min(windowCount, PREVIEW.maxSlots);
  let titles = Math.min(windowCount, PREVIEW.maxRows);
  let layout = previewFor(windowCount, shown, titles);
  if (!room) return layout;
  const fits = (l: PreviewLayout): boolean => l.w <= room.w - 2 * SCREEN_MARGIN && l.h <= room.h - 2 * SCREEN_MARGIN;
  while (!fits(layout) && shown > 1) layout = previewFor(windowCount, --shown, titles);
  while (!fits(layout) && titles > 1) layout = previewFor(windowCount, shown, --titles);
  return layout;
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

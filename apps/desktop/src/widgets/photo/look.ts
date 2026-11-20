/**
 * The border of a photo widget as geometry. Pure maths, so every window computes the same frame
 * from the same stored settings and the rules (how thick a border may get, where the dots go) are
 * unit-tested. Colours, radii and type stay in CSS and come from the design tokens; only the
 * numbers that depend on the widget's measured size live here.
 */
import type { Box } from "./frame";

export type PhotoFrame = "none" | "hairline" | "mat" | "polaroid" | "dots";
export type PhotoShape = "rounded" | "squircle" | "circle";
export type PhotoTint = "paper" | "ink" | "dim" | "accent";

/** The border settings of a photo widget, as stored in its placement. */
export interface LookSettings {
  readonly frame: PhotoFrame;
  readonly shape: PhotoShape;
  /** Corner radius in px for the rounded and squircle shapes. */
  readonly radius: number;
  /** Width of the band between the widget's edge and the photo, in px. */
  readonly thickness: number;
  readonly tint: PhotoTint;
  /** Printed on a polaroid's foot. */
  readonly caption: string;
  readonly shadow: boolean;
}

export const MAX_CAPTION_LENGTH = 40;

/** The photo keeps at least this share of the widget on each axis, however thick the border. */
export const MIN_WINDOW_SHARE = 0.5;
/** A polaroid's foot is this many times as deep as its side band. */
export const POLAROID_FOOT = 4;
/** A dot's diameter as a share of its cell, so neighbouring dots leave a clear gap. */
export const DOT_FILL = 0.5;
/** The fewest dots a ring may have; fewer would not read as a ring. */
export const MIN_RING_DOTS = 12;
/** Samples used to space dots evenly along an ellipse. */
const ARC_SAMPLES = 720;

/** What the border actually is, after the rules that stop settings from contradicting each other. */
export interface Look {
  readonly frame: PhotoFrame;
  readonly shape: PhotoShape;
  readonly radius: number;
  readonly thickness: number;
  readonly tint: PhotoTint;
  readonly caption: string;
  readonly shadow: boolean;
}

export function lookOf(settings: LookSettings): Look {
  const polaroid = settings.frame === "polaroid";
  return {
    frame: settings.frame,
    // A mask would cut a polaroid's caption strip, so a polaroid is always a rounded rectangle.
    shape: polaroid ? "rounded" : settings.shape,
    radius: Math.max(0, settings.radius),
    thickness: settings.frame === "none" ? 0 : Math.max(0, settings.thickness),
    tint: settings.tint,
    caption: polaroid ? settings.caption.trim() : "",
    shadow: settings.shadow,
  };
}

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface Dot {
  readonly x: number;
  readonly y: number;
}

/** Where the photo sits in the widget and where the border's dots are, all in CSS px. */
export interface FrameLayout {
  readonly insets: Insets;
  /** The photo window. */
  readonly window: Box;
  /** Centres of the dot-matrix border's dots; empty for every other border. */
  readonly dots: readonly Dot[];
  readonly dotRadius: number;
}

const NO_DOTS: readonly Dot[] = [];

const uniform = (band: number): Insets => ({ top: band, right: band, bottom: band, left: band });

/**
 * The band the border really gets. A thick border on a small widget would squeeze the photo to a
 * sliver, so it is capped so the photo keeps `MIN_WINDOW_SHARE` of the widget on both axes.
 */
export function bandFor(look: Pick<Look, "frame" | "thickness">, card: Box): number {
  if (look.frame === "none") return 0;
  // Bands stacked along the vertical axis: top and bottom, the bottom being a polaroid's deeper foot.
  const stacked = look.frame === "polaroid" ? 1 + POLAROID_FOOT : 2;
  const room = 1 - MIN_WINDOW_SHARE;
  const limit = Math.min((card.w * room) / 2, (card.h * room) / stacked);
  return Math.max(0, Math.min(look.thickness, limit));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Dots along the four sides of the widget, one cell deep; corner dots are shared by two sides.
 * The cell count is rounded so the cells tile each side exactly. `bandFor` keeps a band within a
 * quarter of the widget, so there are always at least four cells on a side.
 */
function rectRing(card: Box, band: number): { insets: Insets; dots: Dot[]; radius: number } {
  const cols = Math.round(card.w / band);
  const rows = Math.round(card.h / band);
  const cellW = card.w / cols;
  const cellH = card.h / rows;
  const dots: Dot[] = [];
  for (let c = 0; c < cols; c += 1) {
    dots.push({ x: (c + 0.5) * cellW, y: cellH / 2 });
    dots.push({ x: (c + 0.5) * cellW, y: card.h - cellH / 2 });
  }
  for (let r = 1; r < rows - 1; r += 1) {
    dots.push({ x: cellW / 2, y: (r + 0.5) * cellH });
    dots.push({ x: card.w - cellW / 2, y: (r + 0.5) * cellH });
  }
  return {
    insets: { top: cellH, right: cellW, bottom: cellH, left: cellW },
    dots,
    radius: (Math.min(cellW, cellH) * DOT_FILL) / 2,
  };
}

/**
 * True when a circle of radius `r` at `dot` lies wholly inside a card of the given size whose
 * corners have `radius`. A dot that would be cut by a rounded corner is left out of the ring
 * instead of being drawn half missing.
 */
export function fitsRounded(card: Box, radius: number, dot: Dot, r: number): boolean {
  const corner = Math.min(radius, card.w / 2, card.h / 2);
  if (corner <= 0) return true;
  const dx = Math.max(0, Math.abs(dot.x - card.w / 2) - (card.w / 2 - corner));
  const dy = Math.max(0, Math.abs(dot.y - card.h / 2) - (card.h / 2 - corner));
  return Math.hypot(dx, dy) + r <= corner + 1e-9;
}

/** Ramanujan's approximation of an ellipse's perimeter; exact enough to count dots. */
export function ellipsePerimeter(a: number, b: number): number {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

/**
 * `count` points spaced evenly by distance along the ellipse with semi-axes a and b, starting at
 * the top and going clockwise. Even angles would bunch the points at the ends of a wide ellipse.
 */
export function ellipsePoints(a: number, b: number, count: number): Dot[] {
  const cumulative = new Float64Array(ARC_SAMPLES + 1);
  let previous: Dot = { x: 0, y: -b };
  for (let i = 1; i <= ARC_SAMPLES; i += 1) {
    const t = -Math.PI / 2 + (i / ARC_SAMPLES) * 2 * Math.PI;
    const next: Dot = { x: a * Math.cos(t), y: b * Math.sin(t) };
    cumulative[i] = (cumulative[i - 1] ?? 0) + Math.hypot(next.x - previous.x, next.y - previous.y);
    previous = next;
  }
  const total = cumulative[ARC_SAMPLES] ?? 0;
  const points: Dot[] = [];
  let sample = 0;
  for (let k = 0; k < count; k += 1) {
    const target = (k / count) * total;
    while (sample < ARC_SAMPLES - 1 && (cumulative[sample + 1] ?? 0) < target) sample += 1;
    const lo = cumulative[sample] ?? 0;
    const hi = cumulative[sample + 1] ?? lo;
    const along = hi > lo ? (target - lo) / (hi - lo) : 0;
    const t = -Math.PI / 2 + ((sample + along) / ARC_SAMPLES) * 2 * Math.PI;
    points.push({ x: a * Math.cos(t), y: b * Math.sin(t) });
  }
  return points;
}

/** Dots on an ellipse one cell inside the widget's edge, for the circle shape. */
function ellipseRing(card: Box, band: number): { insets: Insets; dots: Dot[]; radius: number } {
  const a = card.w / 2 - band / 2;
  const b = card.h / 2 - band / 2;
  const count = Math.max(MIN_RING_DOTS, Math.round(ellipsePerimeter(a, b) / band));
  const dots = ellipsePoints(a, b, count).map((p) => ({ x: card.w / 2 + p.x, y: card.h / 2 + p.y }));
  return { insets: uniform(band), dots, radius: (band * DOT_FILL) / 2 };
}

/** Where the photo window and the border's dots go for a widget of the measured size. */
export function layoutFrame(look: Look, card: Box): FrameLayout {
  if (card.w <= 0 || card.h <= 0) return { insets: uniform(0), window: { w: 0, h: 0 }, dots: NO_DOTS, dotRadius: 0 };
  const band = bandFor(look, card);
  let insets: Insets;
  let dots: readonly Dot[] = NO_DOTS;
  let dotRadius = 0;
  if (look.frame === "dots" && band > 0) {
    const ring = look.shape === "circle" ? ellipseRing(card, band) : rectRing(card, band);
    insets = ring.insets;
    dots = look.shape === "circle" ? ring.dots : ring.dots.filter((d) => fitsRounded(card, look.radius, d, ring.radius));
    dotRadius = ring.radius;
  } else if (look.frame === "polaroid") {
    insets = { top: band, right: band, bottom: band * POLAROID_FOOT, left: band };
  } else {
    insets = uniform(band);
  }
  return {
    insets,
    window: { w: card.w - insets.left - insets.right, h: card.h - insets.top - insets.bottom },
    dots,
    dotRadius,
  };
}

const px = (n: number): string => `${round2(n)}px`;

/**
 * Custom properties the stylesheet reads: the photo window's insets and the corner radii of the
 * widget and of the window, horizontal and vertical. They are lengths, so a change of border or
 * shape eases between two values (they are registered in PhotoWidget.css). `card` is the inside of
 * the widget's hairline border, which the outer radius adds back so a circle is a true ellipse.
 */
export function lookVars(look: Look, layout: FrameLayout, card: Box): Readonly<Record<string, string>> {
  const { top, right, bottom, left } = layout.insets;
  const vars: Record<string, string> = {
    "--photo-inset-t": px(top),
    "--photo-inset-r": px(right),
    "--photo-inset-b": px(bottom),
    "--photo-inset-l": px(left),
  };
  if (look.shape === "circle") {
    vars["--photo-rx"] = `calc(${px(card.w / 2)} + var(--hairline))`;
    vars["--photo-ry"] = `calc(${px(card.h / 2)} + var(--hairline))`;
    vars["--photo-window-rx"] = px(layout.window.w / 2);
    vars["--photo-window-ry"] = px(layout.window.h / 2);
    return vars;
  }
  vars["--photo-rx"] = px(look.radius);
  vars["--photo-ry"] = px(look.radius);
  // Inside a band the window's corners are concentric with the widget's, but never rounder than a soft corner.
  const inner = (inset: number): string =>
    look.frame === "none"
      ? `max(0px, calc(${px(look.radius)} - var(--hairline)))`
      : `max(0px, calc(min(${px(look.radius - inset)}, var(--radius-sm)) - var(--hairline)))`;
  vars["--photo-window-rx"] = inner(left);
  vars["--photo-window-ry"] = inner(top);
  return vars;
}

/** SVG path data drawing every dot as a circle, in one element. */
export function dotsPath(dots: readonly Dot[], radius: number): string {
  const r = round2(radius);
  return dots
    .map((d) => `M${round2(d.x - radius)} ${round2(d.y)}a${r} ${r} 0 1 0 ${round2(2 * radius)} 0a${r} ${r} 0 1 0 ${round2(-2 * radius)} 0`)
    .join("");
}

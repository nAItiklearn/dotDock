/**
 * Where a photo sits inside its widget. Pure maths, so framing is unit-tested and every window
 * computes the same picture from the same stored numbers.
 *
 * The image is laid out at its final on-screen size (never scaled up by a transform), so the
 * browser resamples straight from the original pixels: zooming never softens the photo.
 */

/** How the photo meets the frame: fill crops to cover it, fit shows the whole photo. */
export type PhotoFit = "fill" | "fit";

export interface Framing {
  /** Focal point as a fraction of the photo, 0..1 on each axis. Fill mode only. */
  readonly x: number;
  readonly y: number;
  /** Magnification over the cover size, MIN_ZOOM..MAX_ZOOM. Fill mode only. */
  readonly zoom: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** One wheel notch (deltaY of 100) zooms by this factor. */
export const WHEEL_ZOOM_PER_100 = 1.12;
/** One arrow-key press pans by this fraction of the frame. */
export const KEY_PAN_STEP = 0.04;
export const KEY_ZOOM_STEP = 1.1;

export const CENTRED: Framing = { x: 0.5, y: 0.5, zoom: MIN_ZOOM };

export interface Box {
  readonly w: number;
  readonly h: number;
}

/** Image rectangle inside the frame, in CSS px. `left`/`top` can be negative (cropped). */
export interface Placed {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function clampFraming(f: Framing): Framing {
  return { x: clamp(f.x, 0, 1), y: clamp(f.y, 0, 1), zoom: clamp(f.zoom, MIN_ZOOM, MAX_ZOOM) };
}

/** The image rectangle for a frame, a photo size, a fit mode and a framing. */
export function place(frame: Box, photo: Box, fit: PhotoFit, framing: Framing): Placed {
  if (frame.w <= 0 || frame.h <= 0 || photo.w <= 0 || photo.h <= 0) return { left: 0, top: 0, width: 0, height: 0 };
  if (fit === "fit") {
    const s = Math.min(frame.w / photo.w, frame.h / photo.h);
    const width = photo.w * s;
    const height = photo.h * s;
    return { left: (frame.w - width) / 2, top: (frame.h - height) / 2, width, height };
  }
  const f = clampFraming(framing);
  const s = Math.max(frame.w / photo.w, frame.h / photo.h) * f.zoom;
  const width = photo.w * s;
  const height = photo.h * s;
  // The focal point lands on the same fraction of the frame, so (0,0) shows the top-left corner.
  // "+ 0" turns a -0 (an edge exactly on the frame) into 0.
  return { left: (frame.w - width) * f.x + 0, top: (frame.h - height) * f.y + 0, width, height };
}

/** Inverse of `place` on one axis: the focal fraction that puts the image edge at `offset`. */
function fractionFor(frameLen: number, imageLen: number, offset: number, fallback: number): number {
  const spare = frameLen - imageLen;
  return spare === 0 ? fallback : clamp(offset / spare, 0, 1);
}

/** Framing after dragging the photo by (dx, dy) CSS px. */
export function pan(frame: Box, photo: Box, framing: Framing, dx: number, dy: number): Framing {
  const now = place(frame, photo, "fill", framing);
  return clampFraming({
    x: fractionFor(frame.w, now.width, now.left + dx, framing.x),
    y: fractionFor(frame.h, now.height, now.top + dy, framing.y),
    zoom: framing.zoom,
  });
}

/** Framing after zooming by `factor`, keeping the photo point under (px, py) in the frame still. */
export function zoomAt(frame: Box, photo: Box, framing: Framing, factor: number, px: number, py: number): Framing {
  const before = place(frame, photo, "fill", framing);
  const zoom = clamp(framing.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  if (before.width === 0 || zoom === framing.zoom) return { ...clampFraming(framing), zoom };
  const u = (px - before.left) / before.width;
  const v = (py - before.top) / before.height;
  const after = place(frame, photo, "fill", { ...framing, zoom });
  return clampFraming({
    x: fractionFor(frame.w, after.width, px - u * after.width, framing.x),
    y: fractionFor(frame.h, after.height, py - v * after.height, framing.y),
    zoom,
  });
}

/** Zoom factor for a wheel event's vertical delta (negative delta zooms in). */
export function wheelFactor(deltaY: number): number {
  return WHEEL_ZOOM_PER_100 ** (-deltaY / 100);
}

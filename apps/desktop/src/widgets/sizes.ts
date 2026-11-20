/**
 * Grid footprints. A widget's sizes are designed layouts, not scaled copies of one another.
 * The four t-shirt ids are what saved layouts already hold. The named ids exist for footprints a
 * t-shirt size cannot describe (a photo can be wide, tall or panoramic); a widget that offers
 * many footprints names them by shape.
 */
export type SizeId = "s" | "m" | "l" | "xl" | "medium" | "landscape" | "tall" | "panorama";

export interface SizeSpec {
  readonly id: SizeId;
  /** Name a size picker shows, e.g. "Pill" or "Month". */
  readonly name: string;
  /** Footprint in grid cells. */
  readonly w: number;
  readonly h: number;
}

/** Sizes smallest first, for pickers; the registry lists the default size first instead. */
export function sizesByArea(sizes: readonly SizeSpec[]): readonly SizeSpec[] {
  return [...sizes].sort((a, b) => a.w * a.h - b.w * b.h);
}

/** Looks a size up by id; an unknown id falls back to the first (default) size. */
export function sizeSpec(sizes: readonly SizeSpec[], id: SizeId): SizeSpec {
  const found = sizes.find((s) => s.id === id) ?? sizes[0];
  if (!found) throw new Error("A widget needs at least one size");
  return found;
}

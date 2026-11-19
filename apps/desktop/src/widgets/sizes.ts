/** Grid footprints. A widget's sizes are designed layouts, not scaled copies of one another. */
export type SizeId = "s" | "m" | "l" | "xl";

export interface SizeSpec {
  readonly id: SizeId;
  /** Name a size picker shows, e.g. "Pill" or "Month". */
  readonly name: string;
  /** Footprint in grid cells. */
  readonly w: number;
  readonly h: number;
}

/** Looks a size up by id; an unknown id falls back to the first (default) size. */
export function sizeSpec(sizes: readonly SizeSpec[], id: SizeId): SizeSpec {
  const found = sizes.find((s) => s.id === id) ?? sizes[0];
  if (!found) throw new Error("A widget needs at least one size");
  return found;
}

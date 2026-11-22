/**
 * Dock magnification as plain maths. Every item has a rest span along the dock's axis; the pointer is a
 * pivot. Items near the pivot grow with a cosine falloff, and the row is stretched so no two items
 * overlap; the row grows evenly about its rest centre, so the bar never slides with the pointer.
 * Nothing here touches the DOM: the engine applies the result as transforms.
 */
/** Pointer positions tried per item when bounding the growth. */
const BOUND_SAMPLES_PER_ITEM = 12;

export interface RestItem {
  /** Start of the item's rest span along the axis, in dock-local px. */
  readonly start: number;
  readonly size: number;
  /** How much of the magnification this item takes: 1 for an app, less for a stack, 0 for tiles, dividers and the status pill, which only make room. */
  readonly weight: number;
}

export interface MagnifyConfig {
  /** Scale of the item right under the pivot at full engagement. 1 turns magnification off. */
  readonly peak: number;
  /** Distance from the pivot at which an item stops growing, in px. */
  readonly radius: number;
  /** 0 (pointer away) to 1 (fully engaged); eased by the engine. */
  readonly engage: number;
}

export interface MagnifyFrame {
  readonly scale: readonly number[];
  /** Translation that moves each item's centre from its rest centre to where it is drawn. */
  readonly shift: readonly number[];
  /** Where the row's first item starts and the last one ends once drawn. */
  readonly rowStart: number;
  readonly rowEnd: number;
  /** Index of the item the pivot is over (gaps count for half their width on each side), or -1. */
  readonly hovered: number;
}

/** 1 at the pivot, 0 from `radius` out, smooth in between. */
export function falloff(distance: number, radius: number): number {
  if (radius <= 0 || distance >= radius) return 0;
  return (1 + Math.cos((Math.PI * Math.max(distance, 0)) / radius)) / 2;
}

/** Scale of one item for a pivot distance. */
export function scaleFor(distance: number, config: MagnifyConfig, weight = 1): number {
  return 1 + (config.peak - 1) * weight * config.engage * falloff(distance, config.radius);
}

export function computeMagnify(items: readonly RestItem[], pivot: number, config: MagnifyConfig, gap: number): MagnifyFrame {
  const n = items.length;
  if (n === 0) return { scale: [], shift: [], rowStart: 0, rowEnd: 0, hovered: -1 };

  const scale = items.map((item) => (item.weight > 0 ? scaleFor(Math.abs(pivot - (item.start + item.size / 2)), config, item.weight) : 1));

  // phiStart / phiEnd: where each span begins and ends along the drawn row, with the first item at 0.
  // The space between two items keeps its rest width.
  const phiStart: number[] = [];
  const phiEnd: number[] = [];
  let cursor = 0;
  items.forEach((item, i) => {
    if (i > 0) {
      const previous = items[i - 1] as RestItem;
      cursor += item.start - (previous.start + previous.size);
    }
    phiStart.push(cursor);
    cursor += item.size * (scale[i] as number);
    phiEnd.push(cursor);
  });

  // The row grows evenly about its rest centre, so the bar stays where it is while the pointer moves along it
  // (owner, 2026-11-22): anchoring the row to the pointer slid the whole dock sideways.
  const first = items[0] as RestItem;
  const last = items[n - 1] as RestItem;
  const rowStart = (first.start + last.start + last.size) / 2 - (phiEnd[n - 1] as number) / 2;
  const shift = items.map((item, i) => {
    const drawnStart = rowStart + (phiStart[i] as number);
    return drawnStart + (item.size * (scale[i] as number)) / 2 - (item.start + item.size / 2);
  });

  const half = gap / 2;
  const hovered = items.findIndex((item) => pivot >= item.start - half && pivot <= item.start + item.size + half);

  return { scale, shift, rowStart, rowEnd: rowStart + (phiEnd[n - 1] as number), hovered };
}

/**
 * Largest total width magnification can add, over every pivot position: sizes the click region while the
 * dock is engaged, so the grown row never leaves it.
 */
export function maxGrowth(items: readonly RestItem[], peak: number, radius: number): number {
  let widest = 0;
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return 0;
  // The total is smooth in the pointer position, so sampling every few px finds its peak to within a hair;
  // the margin covers what lies between samples.
  const step = Math.max(1, first.size / BOUND_SAMPLES_PER_ITEM);
  for (let pivot = first.start; pivot <= last.start + last.size; pivot += step) {
    let total = 0;
    for (const item of items) {
      if (item.weight <= 0) continue;
      total += item.size * (peak - 1) * item.weight * falloff(Math.abs(pivot - (item.start + item.size / 2)), radius);
    }
    widest = Math.max(widest, total);
  }
  return widest;
}

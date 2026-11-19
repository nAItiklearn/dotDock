import type { JsonObject } from "../model/json";
import type { Bounds, Cell, CollisionMode, Placement, Rect, WidgetCatalogMeta, WidgetSize } from "../model/types";
import { normalizeArrangement, resolveMove, resolvePush, type Arrangement, type Item } from "./collision";
import { clampRect, firstFreeSpot, nearestFreeSpot } from "./grid";

/** Everything the pure layout operations need to know about the world. */
export interface LayoutContext {
  readonly bounds: Bounds;
  readonly collision: CollisionMode;
  readonly catalog: WidgetCatalogMeta;
}

export interface Footprint {
  readonly w: number;
  readonly h: number;
}

/** A widget the catalog does not know still occupies a cell, so it cannot be silently built over. */
const UNKNOWN_FOOTPRINT: Footprint = { w: 1, h: 1 };

function resolveSize(catalog: WidgetCatalogMeta, p: Pick<Placement, "kind" | "size">): WidgetSize | null {
  const meta = catalog.get(p.kind);
  if (!meta) return null;
  return meta.sizes.find((s) => s.id === p.size) ?? meta.sizes.find((s) => s.id === meta.defaultSize) ?? meta.sizes[0] ?? null;
}

export function footprintOf(catalog: WidgetCatalogMeta, p: Pick<Placement, "kind" | "size">): Footprint {
  const size = resolveSize(catalog, p);
  return size ? { w: size.w, h: size.h } : UNKNOWN_FOOTPRINT;
}

export function rectOf(catalog: WidgetCatalogMeta, p: Placement): Rect {
  return { x: p.x, y: p.y, ...footprintOf(catalog, p) };
}

function itemsOf(ps: readonly Placement[], ctx: LayoutContext): Item[] {
  return ps.map((p) => ({ id: p.id, ...rectOf(ctx.catalog, p) }));
}

function applyArrangement(ps: readonly Placement[], arrangement: Arrangement): readonly Placement[] {
  let changed = false;
  const next = ps.map((p) => {
    const r = arrangement.get(p.id);
    if (!r || (r.x === p.x && r.y === p.y)) return p;
    changed = true;
    return { ...p, x: r.x, y: r.y };
  });
  return changed ? next : ps;
}

/**
 * Display-safe version of a stored layout: valid size ids, inside the edges, no overlaps.
 * The stored data is never rewritten by this; positions are only saved when the user edits.
 */
export function normalizePlacements(ps: readonly Placement[], ctx: LayoutContext): readonly Placement[] {
  const sized = ps.map((p) => {
    const size = resolveSize(ctx.catalog, p);
    return size && size.id !== p.size ? { ...p, size: size.id } : p;
  });
  const arrangement = normalizeArrangement(itemsOf(sized, ctx), ctx.bounds);
  const placed = applyArrangement(sized, arrangement);
  const unchanged = placed.length === ps.length && placed.every((p, i) => p === ps[i]);
  return unchanged ? ps : placed;
}

/** Where a widget would land if dropped at `cell`, honouring the collision mode. Null when it cannot fit. */
export function arrangeMove(ps: readonly Placement[], id: string, cell: Cell, ctx: LayoutContext): Arrangement | null {
  const moving = ps.find((p) => p.id === id);
  if (!moving) return null;
  const target: Rect = clampRect({ x: cell.x, y: cell.y, ...footprintOf(ctx.catalog, moving) }, ctx.bounds);
  return resolveMove(itemsOf(ps, ctx), id, target, ctx.collision, ctx.bounds);
}

export function moveTo(ps: readonly Placement[], id: string, cell: Cell, ctx: LayoutContext): readonly Placement[] | null {
  const arrangement = arrangeMove(ps, id, cell, ctx);
  return arrangement ? applyArrangement(ps, arrangement) : null;
}

/** Layout after switching a widget to another declared size. Neighbours are pushed; null when it cannot fit. */
export function resizeTo(ps: readonly Placement[], id: string, sizeId: string, ctx: LayoutContext): readonly Placement[] | null {
  const current = ps.find((p) => p.id === id);
  if (!current) return null;
  const meta = ctx.catalog.get(current.kind);
  const size = meta?.sizes.find((s) => s.id === sizeId);
  if (!size) return null;
  if (current.size === size.id) return ps;
  const target = clampRect({ x: current.x, y: current.y, w: size.w, h: size.h }, ctx.bounds);
  const resized = ps.map((p) => (p.id === id ? { ...p, size: size.id } : p));
  const arrangement = resolvePush(itemsOf(resized, ctx), id, target, ctx.bounds);
  return arrangement ? applyArrangement(resized, arrangement) : null;
}

/** The size reached by stepping through the widget's declared sizes from smallest to largest. */
export function neighbourSize(ps: readonly Placement[], id: string, direction: 1 | -1, ctx: LayoutContext): string | null {
  const p = ps.find((x) => x.id === id);
  const meta = p ? ctx.catalog.get(p.kind) : undefined;
  if (!p || !meta || meta.sizes.length < 2) return null;
  const ordered = [...meta.sizes].sort((a, b) => a.w * a.h - b.w * b.h);
  const index = ordered.findIndex((s) => s.id === (resolveSize(ctx.catalog, p)?.id ?? p.size));
  return ordered[index + direction]?.id ?? null;
}

/** Id like "clock-2": readable in files and diffs, unique within the layout. */
export function nextId(kind: string, taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(`${kind}-${n}`)) n++;
  return `${kind}-${n}`;
}

export interface Added {
  readonly placements: readonly Placement[];
  readonly id: string;
}

export function addWidget(
  ps: readonly Placement[],
  kind: string,
  requestedSize: string | undefined,
  ctx: LayoutContext,
): Added | null {
  const meta = ctx.catalog.get(kind);
  if (!meta) return null;
  const size = meta.sizes.find((s) => s.id === requestedSize) ?? meta.sizes.find((s) => s.id === meta.defaultSize) ?? meta.sizes[0];
  if (!size) return null;
  const spot = firstFreeSpot(itemsOf(ps, ctx), size.w, size.h, ctx.bounds);
  if (!spot) return null;
  const id = nextId(kind, new Set(ps.map((p) => p.id)));
  const placement: Placement = { id, kind, size: size.id, x: spot.x, y: spot.y, config: meta.defaultConfig };
  return { placements: [...ps, placement], id };
}

/** Copies a widget, config included, to the nearest free spot (preferring just below-right of the original). */
export function duplicateWidget(ps: readonly Placement[], id: string, ctx: LayoutContext): Added | null {
  const original = ps.find((p) => p.id === id);
  if (!original) return null;
  const { w, h } = footprintOf(ctx.catalog, original);
  const spot = nearestFreeSpot(itemsOf(ps, ctx), w, h, ctx.bounds, { x: original.x + 1, y: original.y + 1 });
  if (!spot) return null;
  const copyId = nextId(original.kind, new Set(ps.map((p) => p.id)));
  return { placements: [...ps, { ...original, id: copyId, x: spot.x, y: spot.y }], id: copyId };
}

export function removeWidget(ps: readonly Placement[], id: string): readonly Placement[] {
  return ps.some((p) => p.id === id) ? ps.filter((p) => p.id !== id) : ps;
}

export function patchConfig(ps: readonly Placement[], id: string, patch: JsonObject): readonly Placement[] {
  return ps.map((p) => (p.id === id ? { ...p, config: { ...p.config, ...patch } } : p));
}

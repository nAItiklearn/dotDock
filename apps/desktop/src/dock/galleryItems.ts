import { LENGTH_RATIO, isPopoverTile } from "./geometry";
import { appsInCategory, isTileId, TILE_IDS, type TileId } from "./model";
import { matchScore } from "./nav";
import type { Category, CategoryId, CategoryTone, DockApp } from "./protocol";
import { categoryLabel, t, type StringKey } from "./strings";

/**
 * The widget gallery: what can be added to the dock, grouped and searchable. Tiles come from the dock's own list;
 * stacks from the categories that are not on the dock yet; and the accounts-based tiles (GitHub, Linear, Vercel)
 * have a reserved slot that stays closed until the integrations track publishes their protocol.
 */
export const GALLERY_CATEGORIES = ["time", "focus", "media", "system", "people", "developer", "stacks"] as const;
export type GalleryCategory = (typeof GALLERY_CATEGORIES)[number];

const TILE_CATEGORY: Readonly<Record<TileId, GalleryCategory>> = {
  clock: "time",
  agenda: "time",
  meeting: "time",
  progress: "time",
  focus: "focus",
  stopwatch: "focus",
  reminders: "focus",
  hydration: "focus",
  media: "media",
  audio: "media",
  mic: "media",
  system: "system",
  contacts: "people",
};

/** Services that need an account. They are opt-in, and have no tile until their feeds and protocol exist. */
export const OPT_IN_SERVICES = ["github", "linear", "vercel"] as const;
export type OptInService = (typeof OPT_IN_SERVICES)[number];

export type GalleryKind = "tile" | "stack" | "optin";

export interface GalleryItem {
  /** Stable across renders and unique in the gallery. */
  readonly key: string;
  readonly kind: GalleryKind;
  readonly category: GalleryCategory;
  readonly name: string;
  /** One sentence on what it shows. */
  readonly about: string;
  /** Words people may search by that the name and sentence do not hold. */
  readonly keywords: string;
  readonly onDock: boolean;
  /** The tile this adds, for kind "tile". */
  readonly tile?: TileId;
  /** The category this adds as a stack, for kind "stack". */
  readonly stack?: CategoryId;
  readonly tone?: CategoryTone;
  /** Apps of a stack, for the count on its card. */
  readonly appCount?: number;
  readonly service?: OptInService;
}

export interface GalleryInput {
  /** `DockSettings.tiles`. */
  readonly tiles: readonly string[];
  /** Stacks pinned to the dock. */
  readonly pinnedStacks: ReadonlySet<CategoryId>;
  readonly categories: readonly Category[];
  readonly apps: readonly DockApp[];
}

export const categoryName = (category: GalleryCategory): string => t(`gallery.category.${category}` as StringKey);

/** Every card the gallery can show, tiles first, then stacks, then the closed slots, each group in a steady order. */
export function galleryItems(input: GalleryInput): GalleryItem[] {
  const onDock = new Set(input.tiles);
  const tiles = TILE_IDS.map(
    (id): GalleryItem => ({
      key: `tile:${id}`,
      kind: "tile",
      category: TILE_CATEGORY[id],
      name: t(`tile.${id}` as StringKey),
      about: t(`gallery.about.${id}` as StringKey),
      keywords: t(`gallery.keywords.${id}` as StringKey),
      onDock: onDock.has(id),
      tile: id,
    }),
  );
  const stacks = [...input.categories]
    .sort((a, b) => a.order - b.order)
    .map((category) => ({ category, count: appsInCategory(input.apps, category.id).length }))
    .filter((s) => s.count > 0)
    .map(
      ({ category, count }): GalleryItem => ({
        key: `stack:${category.id}`,
        kind: "stack",
        category: "stacks",
        name: categoryLabel(category),
        about: t("gallery.about.stack"),
        keywords: t("gallery.keywords.stack"),
        onDock: input.pinnedStacks.has(category.id),
        stack: category.id,
        tone: category.tone,
        appCount: count,
      }),
    );
  const optIn = OPT_IN_SERVICES.map(
    (service): GalleryItem => ({
      key: `optin:${service}`,
      kind: "optin",
      category: "developer",
      name: t(`gallery.optin.${service}` as StringKey),
      about: t(`gallery.optin.${service}.about` as StringKey),
      keywords: t("gallery.keywords.optin"),
      onDock: false,
      service,
    }),
  );
  return [...tiles, ...stacks, ...optIn];
}

/**
 * The cards that answer a search inside a category (or all of them), best match first. A search looks at the
 * name, what the card does, its extra words and its category; with no search the order is the gallery's own.
 */
export function filterGallery(items: readonly GalleryItem[], query: string, category: GalleryCategory | "all"): GalleryItem[] {
  const inCategory = items.filter((item) => category === "all" || item.category === category);
  if (query.trim() === "") return inCategory;
  return inCategory
    .map((item, order) => ({ item, order, score: matchScore({ name: item.name, publisher: `${item.about} ${item.keywords}` }, query, categoryName(item.category)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((r) => r.item);
}

/** How many cards each category holds for the current search, so the chips can show what is behind them. */
export function categoryCounts(items: readonly GalleryItem[], query: string): Readonly<Record<GalleryCategory | "all", number>> {
  const counts = { all: filterGallery(items, query, "all").length } as Record<GalleryCategory | "all", number>;
  for (const category of GALLERY_CATEGORIES) counts[category] = filterGallery(items, query, category).length;
  return counts;
}

/** How a tile sits on the dock: a round mark alone, or a mark with words beside it. */
export type TileShape = "round" | "wide";

export const shapeOf = (id: TileId): TileShape => (LENGTH_RATIO[id][0] > LENGTH_RATIO[id][1] * 1.2 ? "wide" : "round");

/** What a tile does when pressed, for the chips on its card. */
export type TileAction = "popover" | "toggle" | "display";

export function actionOf(id: TileId): TileAction {
  if (isPopoverTile(id)) return "popover";
  return id === "mic" ? "toggle" : "display";
}

/**
 * Puts `id` into the tile list at `index` among the tiles the dock draws (clamped), moving it if it is already there.
 * Ids this version does not know are kept, after the others: they may belong to a newer one, and are never dropped.
 */
export function placeTile(tiles: readonly string[], id: TileId, index: number): string[] {
  const known = tiles.filter((tile): tile is TileId => isTileId(tile) && tile !== id).filter((tile, i, all) => all.indexOf(tile) === i);
  const unknown = tiles.filter((tile) => !isTileId(tile));
  const at = Math.min(Math.max(Math.round(index), 0), known.length);
  return [...known.slice(0, at), id, ...known.slice(at), ...unknown];
}

/**
 * Where a card dropped on the dock lands among the tiles: before the first tile whose middle is past the pointer,
 * or at the end. `middles` are the tiles' centres along the dock's axis, in the order they are listed.
 */
export function dropIndex(middles: readonly number[], pointer: number): number {
  const before = middles.findIndex((middle) => pointer < middle);
  return before === -1 ? middles.length : before;
}

/** Whether a card can be added right now: it is not already on the dock, and is not a slot that is still closed. */
export const isAddable = (item: GalleryItem): boolean => item.kind !== "optin" && !item.onDock;

/** What a dragged card carries, so the bar can tell it from anything else dropped on it. */
export const GALLERY_MIME = "application/x-dotdock-widget";

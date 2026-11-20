import type { Category, CategoryId, DockApp, DockSettings, DockWindow, PinnedItem } from "./protocol";
import { MAGNIFY_WEIGHT, type LengthKind } from "./geometry";
import { categoryLabel } from "./strings";
import { sizeOf, type TileSize, type TileSizes } from "./tiles/sizes";

/** Live tiles the dock knows how to draw. Ids in `DockSettings.tiles` that are not listed here are ignored. */
export const TILE_IDS = [
  "clock",
  "media",
  "system",
  "agenda",
  "meeting",
  "focus",
  "stopwatch",
  "hydration",
  "reminders",
  "progress",
  "contacts",
  "mic",
  "audio",
  "cpu",
  "battery",
  "analog",
  "notes",
  "colour",
  "convert",
  "emoji",
  "world",
  "network",
  "toggles",
  "flip",
  "sun",
  "wind",
  "currency",
  "search",
  "history",
  "memo",
] as const;
export type TileId = (typeof TILE_IDS)[number];
export const isTileId = (id: string): id is TileId => (TILE_IDS as readonly string[]).includes(id);

/** An app counts as new for this long after the core first saw it. */
export const NEW_APP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/**
 * More new apps than this at once means the core just scanned the Start menu for the first time, not that
 * the user installed that many apps: nothing is badged then.
 */
export const FIRST_SCAN_THRESHOLD = 12;

export interface AppEntry {
  readonly kind: "app";
  readonly key: string;
  /** Null for a running window that has no Start menu entry. */
  readonly appId: string | null;
  readonly name: string;
  readonly icon: string;
  readonly category: CategoryId | null;
  readonly windows: readonly DockWindow[];
  readonly pinned: boolean;
  readonly fresh: boolean;
}

export interface StackEntry {
  readonly kind: "stack";
  readonly key: string;
  readonly category: Category;
  readonly label: string;
  /** Every app filed in the category, by name. */
  readonly apps: readonly DockApp[];
  /** The four apps the tile previews. */
  readonly preview: readonly DockApp[];
  /** Apps in the stack that are new. */
  readonly fresh: number;
  readonly running: number;
}

export type BarEntry =
  | AppEntry
  | StackEntry
  | { readonly kind: "divider"; readonly key: string }
  | { readonly kind: "library"; readonly key: string }
  | { readonly kind: "tile"; readonly key: string; readonly id: TileId; readonly size: TileSize }
  | { readonly kind: "status"; readonly key: string }
  | { readonly kind: "add"; readonly key: string };

export const PREVIEW_ICONS = 4;

const byName = (a: { readonly name: string }, b: { readonly name: string }): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/** Which length rule the layout uses for an entry. */
export function lengthKind(entry: BarEntry): LengthKind {
  switch (entry.kind) {
    case "divider":
      return "divider";
    case "tile":
      return entry.size === "compact" ? "item" : entry.id;
    case "status":
      return "status";
    default:
      return "item";
  }
}

/** Share of the magnification an entry takes. Tiles and the status pill only make room. */
export function magnifyWeight(entry: BarEntry): number {
  switch (entry.kind) {
    case "app":
      return MAGNIFY_WEIGHT.app;
    case "stack":
      return MAGNIFY_WEIGHT.stack;
    case "library":
    case "add":
      return MAGNIFY_WEIGHT.control;
    default:
      return 0;
  }
}

export interface WindowGroup {
  readonly key: string;
  readonly appId: string | null;
  readonly name: string;
  readonly icon: string;
  readonly windows: readonly DockWindow[];
}

/**
 * Windows of the same app, in the order the core lists them. Windows with no Start menu entry are grouped
 * by the icon of their executable, which is the best identity the core gives them.
 */
export function groupWindows(windows: readonly DockWindow[], appsById: ReadonlyMap<string, DockApp>): WindowGroup[] {
  const groups = new Map<string, { appId: string | null; name: string; icon: string; windows: DockWindow[] }>();
  for (const w of windows) {
    const app = w.appId === null ? undefined : appsById.get(w.appId);
    const key = w.appId !== null && app ? `app:${w.appId}` : `exe:${w.icon}`;
    const group = groups.get(key);
    if (group) group.windows.push(w);
    else groups.set(key, { appId: app ? w.appId : null, name: app?.name ?? w.title, icon: app?.icon ?? w.icon, windows: [w] });
  }
  return [...groups.entries()].map(([key, g]) => ({ key, ...g }));
}

/** Ids of apps to badge as new. */
export function freshAppIds(apps: readonly DockApp[], seen: ReadonlySet<string>, now: number): ReadonlySet<string> {
  const fresh = apps.filter((a) => now - a.firstSeen < NEW_APP_WINDOW_MS && now >= a.firstSeen && !seen.has(a.id));
  return new Set(fresh.length > FIRST_SCAN_THRESHOLD ? [] : fresh.map((a) => a.id));
}

export interface BuildInput {
  readonly categories: readonly Category[];
  readonly apps: readonly DockApp[];
  readonly windows: readonly DockWindow[];
  readonly settings: Pick<DockSettings, "pinned" | "tiles">;
}

export interface BuildOptions {
  readonly now: number;
  readonly seen: ReadonlySet<string>;
  readonly editing: boolean;
  /** Whether the status pill is shown (it needs room on a small screen). */
  readonly status: boolean;
  /** How long each tile is on the dock; tiles not listed are regular. */
  readonly sizes?: TileSizes | undefined;
}

/** The ordered entries the bar shows: library, pinned apps and stacks, running apps, live tiles, status. */
export function buildEntries(input: BuildInput, options: BuildOptions): BarEntry[] {
  const appsById = new Map(input.apps.map((a) => [a.id, a]));
  const categoriesById = new Map(input.categories.map((c) => [c.id, c]));
  const groups = groupWindows(input.windows, appsById);
  const groupByApp = new Map(groups.filter((g) => g.appId !== null).map((g) => [g.appId as string, g]));
  const fresh = freshAppIds(input.apps, options.seen, options.now);

  const pinnedAppIds = new Set<string>();
  const pinned: BarEntry[] = [];
  for (const item of input.settings.pinned) {
    const entry = pinnedEntry(item, appsById, categoriesById, input.apps, groupByApp, fresh);
    if (!entry) continue;
    if (entry.kind === "app" && entry.appId !== null) pinnedAppIds.add(entry.appId);
    pinned.push(entry);
  }

  const running: BarEntry[] = groups
    .filter((g) => g.appId === null || !pinnedAppIds.has(g.appId))
    .map((g) => ({
      kind: "app",
      key: g.key,
      appId: g.appId,
      name: g.name,
      icon: g.icon,
      category: g.appId === null ? null : (appsById.get(g.appId)?.category ?? null),
      windows: g.windows,
      pinned: false,
      fresh: g.appId !== null && fresh.has(g.appId),
    }));

  const tiles: BarEntry[] = input.settings.tiles
    .filter(isTileId)
    .filter((id, i, all) => all.indexOf(id) === i)
    .map((id) => ({ kind: "tile", key: `tile:${id}`, id, size: sizeOf(options.sizes, id) }));

  const entries: BarEntry[] = [{ kind: "library", key: "library" }, ...pinned];
  if (options.editing) entries.push({ kind: "add", key: "add" });
  const sections: BarEntry[][] = [running, tiles];
  if (options.status) sections.push([{ kind: "status", key: "status" }]);
  let dividers = 0;
  for (const section of sections) {
    if (section.length === 0) continue;
    entries.push({ kind: "divider", key: `divider:${dividers++}` }, ...section);
  }
  return entries;
}

function pinnedEntry(
  item: PinnedItem,
  appsById: ReadonlyMap<string, DockApp>,
  categoriesById: ReadonlyMap<CategoryId, Category>,
  allApps: readonly DockApp[],
  groupByApp: ReadonlyMap<string, WindowGroup>,
  fresh: ReadonlySet<string>,
): BarEntry | null {
  if (item.kind === "app") {
    const app = appsById.get(item.id);
    if (!app) return null;
    return {
      kind: "app",
      key: `app:${app.id}`,
      appId: app.id,
      name: app.name,
      icon: app.icon,
      category: app.category,
      windows: groupByApp.get(app.id)?.windows ?? [],
      pinned: true,
      fresh: fresh.has(app.id),
    };
  }
  const category = categoriesById.get(item.category);
  if (!category) return null;
  const apps = allApps.filter((a) => a.category === category.id).sort(byName);
  return {
    kind: "stack",
    key: `stack:${category.id}`,
    category,
    label: categoryLabel(category),
    apps,
    preview: apps.slice(0, PREVIEW_ICONS),
    fresh: apps.filter((a) => fresh.has(a.id)).length,
    running: apps.filter((a) => groupByApp.has(a.id)).length,
  };
}

/** Every stack's apps, by name, for the popover and the App Library. */
export function appsInCategory(apps: readonly DockApp[], category: CategoryId): DockApp[] {
  return apps.filter((a) => a.category === category).sort(byName);
}

/** Categories that have at least one app, lowest order first. */
export function categoriesWithApps(categories: readonly Category[], apps: readonly DockApp[]): Category[] {
  const used = new Set(apps.map((a) => a.category));
  return [...categories].filter((c) => used.has(c.id)).sort((a, b) => a.order - b.order);
}

export interface Indicator {
  /** Dots shown under the item: none, one window, or several. */
  readonly dots: 0 | 1 | 2;
  readonly focused: boolean;
  readonly attention: boolean;
}

export function indicatorFor(windows: readonly DockWindow[]): Indicator {
  return {
    dots: windows.length === 0 ? 0 : windows.length === 1 ? 1 : 2,
    focused: windows.some((w) => w.focused),
    attention: windows.some((w) => w.flashing),
  };
}

/**
 * The window a click on a running app brings forward. One window: that window, and the core minimises it when
 * it is already in front. Several: the next one after the focused window, so repeated clicks cycle through them.
 */
export function activationTarget(windows: readonly DockWindow[]): DockWindow | null {
  const first = windows[0];
  if (!first) return null;
  const focusedAt = windows.findIndex((w) => w.focused);
  if (windows.length === 1) return first;
  if (focusedAt >= 0) return windows[(focusedAt + 1) % windows.length] ?? first;
  return windows.find((w) => !w.minimized) ?? first;
}

/** Pins an app or stack at the end of the pinned list, once. */
export function pin(pinned: readonly PinnedItem[], item: PinnedItem): PinnedItem[] {
  return pinned.some((p) => samePin(p, item)) ? [...pinned] : [...pinned, item];
}

export function unpin(pinned: readonly PinnedItem[], item: PinnedItem): PinnedItem[] {
  return pinned.filter((p) => !samePin(p, item));
}

export const samePin = (a: PinnedItem, b: PinnedItem): boolean =>
  a.kind === "app" ? b.kind === "app" && a.id === b.id : b.kind === "stack" && a.category === b.category;

/** The entry key a pinned item is drawn under. */
export const pinKey = (item: PinnedItem): string => (item.kind === "app" ? `app:${item.id}` : `stack:${item.category}`);

export const tileKey = (id: string): string => `tile:${id}`;

/**
 * Puts the items whose key is in `ordered` into that order, in the places those items occupy; every other
 * item (a pinned app that was uninstalled, say) keeps its place.
 */
export function reorderBy<T>(items: readonly T[], keyOf: (item: T) => string, ordered: readonly string[]): T[] {
  const byKey = new Map(items.map((item) => [keyOf(item), item]));
  const queue = ordered.filter((key) => byKey.has(key));
  const inOrder = new Set(queue);
  return items.map((item) => {
    if (!inOrder.has(keyOf(item))) return item;
    const key = queue.shift();
    return key === undefined ? item : (byKey.get(key) as T);
  });
}

/** The pinned item an entry stands for, or null for entries that cannot be pinned. */
export function pinOf(entry: BarEntry): PinnedItem | null {
  if (entry.kind === "stack") return { kind: "stack", category: entry.category.id };
  if (entry.kind === "app" && entry.appId !== null) return { kind: "app", id: entry.appId };
  return null;
}

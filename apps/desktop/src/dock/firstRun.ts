import type { Category, CategoryId, DockApp, DockSettings, PinnedItem } from "./protocol";

/**
 * The dock a new user sees on the first run: a full, real layout built from the apps the core found on this machine,
 * so the range of the dock shows at first glance. A few well-known apps are pinned (one or two per kind of work),
 * every category that has apps becomes a stack, and five everyday tiles sit on the right. Nothing is invented: an app
 * is pinned only if it is installed, a stack only if it has apps.
 */

/** Categories in the order their best app is pinned; each gets this many pins at most. */
const PIN_ORDER: readonly (readonly [CategoryId, number])[] = [
  ["browsers", 1],
  ["system", 1],
  ["productivity", 2],
  ["communication", 2],
  ["development", 1],
  ["ai", 1],
  ["creative", 1],
  ["media", 1],
];

/** At most this many apps are pinned, so the dock is full but not cluttered. */
export const FIRST_RUN_PINS = 9;

/** Categories never turned into a stack on their own: everything filed there is a leftover. */
const NO_STACK: readonly CategoryId[] = ["other"];

/** The everyday tiles, in dock order: the time, the weather, what is playing, the battery and the day ahead. */
export const FIRST_RUN_TILES = ["clock", "weather", "media", "battery", "agenda"] as const;

/** Apps the core recognised by name beat ones filed by a rule or a fallback; among equals, the oldest install wins. */
const FILED_RANK: Record<DockApp["filedBy"], number> = { user: 0, known: 0, store: 1, rule: 2, fallback: 3 };

const byConfidence = (a: DockApp, b: DockApp): number => FILED_RANK[a.filedBy] - FILED_RANK[b.filedBy] || a.firstSeen - b.firstSeen || a.name.localeCompare(b.name);

/** The pinned items of a first-run dock: apps first, then one stack per category that has apps, in category order. */
export function firstRunPins(apps: readonly DockApp[], categories: readonly Category[]): PinnedItem[] {
  const pins: PinnedItem[] = [];
  for (const [category, most] of PIN_ORDER) {
    const best = apps.filter((app) => app.category === category).sort(byConfidence).slice(0, most);
    for (const app of best) if (pins.length < FIRST_RUN_PINS) pins.push({ kind: "app", id: app.id });
  }
  const filled = new Set(apps.map((app) => app.category));
  const stacks = [...categories]
    .filter((c) => filled.has(c.id) && !NO_STACK.includes(c.id))
    .sort((a, b) => a.order - b.order)
    .map((c): PinnedItem => ({ kind: "stack", category: c.id }));
  return [...pins, ...stacks];
}

/**
 * Whether these settings are a dock nobody has laid out yet: nothing pinned and no tiles. A user who empties the dock
 * on purpose is not reseeded, because the seeding is remembered (see `markSeeded`).
 */
export const isUnlaidOut = (settings: DockSettings): boolean => settings.pinned.length === 0 && settings.tiles.length === 0;

export const SEEDED_KEY = "dotdock.dock.seeded";

export function wasSeeded(): boolean {
  try {
    return localStorage.getItem(SEEDED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markSeeded(): void {
  try {
    localStorage.setItem(SEEDED_KEY, "1");
  } catch {
    // Without storage the dock may be laid out again next time, which only restores the same defaults.
  }
}

/** The settings change that lays out a first-run dock, or null when there is nothing to do. */
export function firstRunLayout(settings: DockSettings, apps: readonly DockApp[], categories: readonly Category[], seeded: boolean): Pick<DockSettings, "pinned" | "tiles"> | null {
  if (seeded || !isUnlaidOut(settings) || apps.length === 0) return null;
  return { pinned: firstRunPins(apps, categories), tiles: [...FIRST_RUN_TILES] };
}

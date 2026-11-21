import { describe, expect, it } from "vitest";
import { moveKey } from "./reorder";
import { buildEntries, isTileId, pin, pinKey, reorderBy, TILE_IDS, tileKey, unpin, type BarEntry } from "./model";
import type { Category, DockApp, DockWindow, PinnedItem } from "./protocol";
import { DOCK_THEMES, isDockTheme, type DockThemeId } from "./theme";

/**
 * Random sequences of what a user does to the dock (pin, unpin, reorder, add and remove tiles, open and close apps,
 * change the look), applied through the same functions the dock uses. After every step the bar must keep its
 * invariants. The generator is seeded, so a failure names the seed and step that reproduce it.
 */

const RUNS = 60;
const STEPS = 80;

/** A small deterministic generator (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const categories: Category[] = [
  { id: "development", name: null, tone: "blue", order: 0 },
  { id: "media", name: null, tone: "pink", order: 1 },
  { id: "games", name: null, tone: "green", order: 2 },
];
const apps: DockApp[] = ["code", "term", "music", "chess", "paint", "mail"].map((id, i) => ({
  id,
  name: id,
  category: categories[i % categories.length]?.id ?? "development",
  filedBy: "known",
  icon: `icon:${id}`,
  publisher: null,
  firstSeen: 0,
}));

interface World {
  pinned: PinnedItem[];
  tiles: string[];
  windows: DockWindow[];
  theme: DockThemeId;
}

function step(world: World, next: () => number): void {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
  const item = (): PinnedItem => (next() < 0.7 ? { kind: "app", id: pick(apps).id } : { kind: "stack", category: pick(categories).id });
  switch (Math.floor(next() * 8)) {
    case 0:
      world.pinned = pin(world.pinned, item());
      return;
    case 1:
      world.pinned = unpin(world.pinned, item());
      return;
    case 2: {
      const keys = world.pinned.map(pinKey);
      if (keys.length > 0) world.pinned = reorderBy(world.pinned, pinKey, moveKey(keys, pick(keys), Math.floor(next() * keys.length)));
      return;
    }
    case 3:
      // The gallery and the store may hand over an id twice or one this version does not know.
      world.tiles = [...world.tiles, next() < 0.9 ? pick(TILE_IDS) : "retired-tile"];
      return;
    case 4:
      world.tiles = world.tiles.filter((t) => t !== pick(world.tiles.length > 0 ? world.tiles : ["none"]));
      return;
    case 5: {
      const keys = world.tiles.filter(isTileId).map(tileKey);
      if (keys.length > 0) world.tiles = reorderBy(world.tiles.filter(isTileId), tileKey, moveKey(keys, pick(keys), Math.floor(next() * keys.length)));
      return;
    }
    case 6: {
      const id = `w${Math.floor(next() * 1e6)}`;
      world.windows = [...world.windows, { hwnd: id, appId: next() < 0.8 ? pick(apps).id : null, title: id, icon: `exe:${id}`, minimized: false, focused: false, flashing: false }];
      return;
    }
    default:
      if (next() < 0.5 && world.windows.length > 0) world.windows = world.windows.filter((w) => w !== pick(world.windows));
      else world.theme = pick(DOCK_THEMES);
  }
}

function check(entries: readonly BarEntry[], world: World, editing: boolean): void {
  const keys = entries.map((e) => e.key);
  expect(new Set(keys).size, "every key is unique").toBe(keys.length);
  expect(entries[0]?.kind, "the App Library button comes first").toBe("library");
  expect(entries[entries.length - 1]?.kind, "the ⋯ button comes last").toBe("more");
  for (let i = 1; i < entries.length; i += 1) {
    const both = entries[i]?.kind === "divider" && entries[i - 1]?.kind === "divider";
    expect(both, "no two dividers in a row").toBe(false);
  }
  expect(entries[entries.length - 2]?.kind, "no divider right before the ⋯ button").not.toBe("divider");
  const tiles = entries.flatMap((e) => (e.kind === "tile" ? [e.id] : []));
  expect(new Set(tiles).size, "a tile appears once").toBe(tiles.length);
  expect(tiles.every(isTileId), "only known tiles are drawn").toBe(true);
  const expectedPinned = world.pinned.map(pinKey).filter((k) => keys.includes(k));
  const drawnPinned = entries.filter((e) => (e.kind === "app" && e.pinned) || e.kind === "stack").map((e) => e.key);
  expect(drawnPinned, "pinned items keep their order").toEqual(expectedPinned);
  const appEntries = entries.filter((e) => e.kind === "app" && e.appId !== null);
  const appIds = appEntries.map((e) => (e.kind === "app" ? e.appId : null));
  expect(new Set(appIds).size, "an app is drawn once, pinned or running").toBe(appIds.length);
  expect(keys.includes("add"), "the add button shows only in edit mode").toBe(editing);
  expect(isDockTheme(world.theme), "the look is always one the dock has").toBe(true);
}

describe("the dock's state under random use", () => {
  it(`keeps every invariant over ${RUNS} runs of ${STEPS} steps`, () => {
    for (let seed = 1; seed <= RUNS; seed += 1) {
      const next = random(seed);
      const world: World = { pinned: [], tiles: [], windows: [], theme: "glass" };
      for (let i = 0; i < STEPS; i += 1) {
        step(world, next);
        const editing = next() < 0.2;
        const entries = buildEntries({ categories, apps, windows: world.windows, settings: { pinned: world.pinned, tiles: world.tiles } }, { now: 0, seen: new Set(), editing, status: next() < 0.8 });
        try {
          check(entries, world, editing);
        } catch (err) {
          throw new Error(`seed ${seed}, step ${i}: ${String(err)}`);
        }
      }
    }
  });
});

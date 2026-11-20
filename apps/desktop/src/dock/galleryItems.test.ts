import { describe, expect, it } from "vitest";
import {
  actionOf,
  categoryCounts,
  dropIndex,
  filterGallery,
  GALLERY_CATEGORIES,
  galleryItems,
  isAddable,
  OPT_IN_SERVICES,
  placeTile,
  type GalleryInput,
} from "./galleryItems";
import { shapeOf } from "./geometry";
import { TILE_IDS } from "./model";
import type { Category, DockApp } from "./protocol";

const category = (id: string, order: number): Category => ({ id: id as Category["id"], name: null, tone: "blue", order });
const app = (id: string, cat: string): DockApp => ({ id, name: id, category: cat as DockApp["category"], filedBy: "known", icon: "", publisher: null, firstSeen: 0 });

const input = (over: Partial<GalleryInput> = {}): GalleryInput => ({
  tiles: ["clock"],
  pinnedStacks: new Set(["media"]),
  categories: [category("media", 1), category("games", 0), category("system", 2)],
  apps: [app("a", "media"), app("b", "media"), app("c", "games")],
  ...over,
});

describe("galleryItems", () => {
  const items = galleryItems(input());

  it("has a card for every tile, once, with its words", () => {
    const tiles = items.filter((i) => i.kind === "tile");
    expect(tiles.map((i) => i.tile)).toEqual([...TILE_IDS]);
    for (const tile of tiles) {
      expect(tile.name).not.toBe("");
      expect(tile.about).not.toBe("");
      expect(tile.keywords).not.toBe("");
    }
  });

  it("marks what is on the dock already", () => {
    expect(items.find((i) => i.key === "tile:clock")?.onDock).toBe(true);
    expect(items.find((i) => i.key === "tile:media")?.onDock).toBe(false);
    expect(items.find((i) => i.key === "stack:media")?.onDock).toBe(true);
    expect(items.find((i) => i.key === "stack:games")?.onDock).toBe(false);
  });

  it("lists the stacks that hold apps, in the user's order, and none that are empty", () => {
    expect(items.filter((i) => i.kind === "stack").map((i) => i.stack)).toEqual(["games", "media"]);
    expect(items.find((i) => i.key === "stack:media")?.appCount).toBe(2);
  });

  it("reserves a closed slot for each account-based service", () => {
    const slots = items.filter((i) => i.kind === "optin");
    expect(slots.map((i) => i.service)).toEqual([...OPT_IN_SERVICES]);
    expect(slots.every((i) => i.category === "developer" && !i.onDock)).toBe(true);
    expect(OPT_IN_SERVICES).toEqual(["github", "linear", "vercel"]);
  });

  it("gives every card its own key and puts it in a group that exists", () => {
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    expect(items.every((i) => (GALLERY_CATEGORIES as readonly string[]).includes(i.category))).toBe(true);
  });

  it("puts every tile in a group, so none can only be found by searching", () => {
    for (const id of TILE_IDS) expect(items.find((i) => i.tile === id)?.category).toBeDefined();
  });
});

describe("isAddable", () => {
  const items = galleryItems(input());
  it("is true for what is not on the dock, and false for what is, and for closed slots", () => {
    expect(isAddable(items.find((i) => i.key === "tile:media") ?? items[0]!)).toBe(true);
    expect(isAddable(items.find((i) => i.key === "tile:clock") ?? items[0]!)).toBe(false);
    expect(isAddable(items.find((i) => i.kind === "optin") ?? items[0]!)).toBe(false);
  });
});

describe("filterGallery", () => {
  const items = galleryItems(input());
  const keys = (list: readonly { key: string }[]): string[] => list.map((i) => i.key);

  it("shows everything with no search and no group, and one group when picked", () => {
    expect(filterGallery(items, "", "all")).toHaveLength(items.length);
    expect(keys(filterGallery(items, "", "people"))).toEqual(["tile:contacts"]);
    expect(keys(filterGallery(items, "", "developer"))).toEqual(["optin:github", "optin:linear", "optin:vercel"]);
  });

  it("finds a tile by its name, best match first", () => {
    expect(filterGallery(items, "stopwatch", "all")[0]?.key).toBe("tile:stopwatch");
    expect(filterGallery(items, "mic", "all")[0]?.key).toBe("tile:mic");
  });

  it("finds a tile by what people call it, not only by its name", () => {
    expect(keys(filterGallery(items, "water", "all"))).toContain("tile:hydration");
    expect(keys(filterGallery(items, "pomodoro", "all"))).toContain("tile:focus");
    expect(keys(filterGallery(items, "spotify", "all"))).toContain("tile:media");
    expect(keys(filterGallery(items, "zoom", "all"))).toContain("tile:meeting");
  });

  it("finds a card by the name of its group", () => {
    expect(keys(filterGallery(items, "people", "all"))).toContain("tile:contacts");
  });

  it("ignores accents and case", () => {
    expect(keys(filterGallery(items, "CALENDÁR", "all"))).toContain("tile:agenda");
  });

  it("finds the closed slots by their service", () => {
    expect(keys(filterGallery(items, "github", "all"))).toEqual(["optin:github"]);
    expect(keys(filterGallery(items, "deployments", "all"))).toContain("optin:vercel");
  });

  it("keeps a search inside the group that is picked", () => {
    expect(filterGallery(items, "timer", "time")).toEqual([]);
    expect(keys(filterGallery(items, "timer", "focus"))).toContain("tile:stopwatch");
  });

  it("returns nothing for nonsense", () => {
    expect(filterGallery(items, "qzxv", "all")).toEqual([]);
  });
});

describe("categoryCounts", () => {
  const items = galleryItems(input());

  it("counts each group, and all of them", () => {
    const counts = categoryCounts(items, "");
    expect(counts.all).toBe(items.length);
    expect(counts.people).toBe(1);
    expect(counts.stacks).toBe(2);
    expect(GALLERY_CATEGORIES.reduce((sum, c) => sum + counts[c], 0)).toBe(items.length);
  });

  it("follows the search, so a group with no match can be shown as empty", () => {
    const counts = categoryCounts(items, "water");
    expect(counts.focus).toBeGreaterThan(0);
    expect(counts.people).toBe(0);
    expect(counts.all).toBe(GALLERY_CATEGORIES.reduce((sum, c) => sum + counts[c], 0));
  });
});

describe("shapeOf and actionOf", () => {
  it("calls a tile with words beside its mark wide, and a lone mark round", () => {
    for (const id of ["agenda", "meeting", "focus", "stopwatch", "reminders", "progress", "contacts", "media"] as const) expect(shapeOf(id)).toBe("wide");
    for (const id of ["hydration", "mic", "audio", "system"] as const) expect(shapeOf(id)).toBe("round");
  });

  it("says what pressing a tile does", () => {
    expect(actionOf("agenda")).toBe("popover");
    expect(actionOf("audio")).toBe("popover");
    expect(actionOf("mic")).toBe("toggle");
    expect(actionOf("clock")).toBe("display");
    expect(actionOf("media")).toBe("display");
  });
});

describe("placeTile", () => {
  it("inserts at the index, and at the end past it", () => {
    expect(placeTile(["clock", "media"], "focus", 1)).toEqual(["clock", "focus", "media"]);
    expect(placeTile(["clock", "media"], "focus", 99)).toEqual(["clock", "media", "focus"]);
    expect(placeTile(["clock", "media"], "focus", -3)).toEqual(["focus", "clock", "media"]);
    expect(placeTile([], "focus", 0)).toEqual(["focus"]);
  });

  it("moves a tile that is already there instead of doubling it", () => {
    expect(placeTile(["clock", "media", "system"], "clock", 2)).toEqual(["media", "system", "clock"]);
    expect(placeTile(["clock", "clock"], "media", 0)).toEqual(["media", "clock"]);
  });

  it("keeps ids this version does not know, after the others", () => {
    expect(placeTile(["clock", "weather", "media"], "focus", 1)).toEqual(["clock", "focus", "media", "weather"]);
  });
});

describe("dropIndex", () => {
  const middles = [100, 200, 300];

  it("is the index of the first tile whose middle is past the pointer", () => {
    expect(dropIndex(middles, 50)).toBe(0);
    expect(dropIndex(middles, 150)).toBe(1);
    expect(dropIndex(middles, 250)).toBe(2);
  });

  it("is the end past the last, and 0 with no tiles on the dock", () => {
    expect(dropIndex(middles, 900)).toBe(3);
    expect(dropIndex([], 123)).toBe(0);
  });

  it("puts a drop exactly on a middle after that tile", () => {
    expect(dropIndex(middles, 200)).toBe(2);
  });
});

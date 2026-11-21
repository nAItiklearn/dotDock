import { describe, expect, it, vi } from "vitest";
import { FIRST_RUN_PINS, FIRST_RUN_TILES, firstRunLayout, firstRunPins } from "./firstRun";
import { isTileId } from "./model";
import type { Category, CategoryId, DockApp, DockSettings } from "./protocol";

// The store reads the page address when it is created, and the bridge asks the window whether it runs in Tauri; the
// tests have neither.
vi.stubGlobal("location", { search: "" });
vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined });
const { DEFAULT_SETTINGS } = await import("./store");

const app = (id: string, category: CategoryId, filedBy: DockApp["filedBy"] = "known", firstSeen = 1): DockApp => ({
  id,
  name: id,
  category,
  filedBy,
  icon: `dock-icon://${id}.png`,
  publisher: null,
  firstSeen,
});
const category = (id: CategoryId, order: number): Category => ({ id, name: null, tone: "neutral", order });

const categories = [
  category("browsers", 0),
  category("productivity", 1),
  category("communication", 2),
  category("development", 3),
  category("creative", 4),
  category("media", 5),
  category("games", 6),
  category("utilities", 7),
  category("system", 8),
  category("other", 9),
];

const machine = [
  app("Edge", "browsers"),
  app("Explorer", "system"),
  app("Word", "productivity"),
  app("Excel", "productivity", "known", 2),
  app("OneNote", "productivity", "known", 3),
  app("Teams", "communication"),
  app("Code", "development"),
  app("Spotify", "media"),
  app("Paint", "creative", "rule"),
  app("Krita", "creative", "known", 5),
  app("Solitaire", "games"),
  app("Readme viewer", "other", "fallback"),
];

describe("the first-run dock", () => {
  it("pins well-known apps of the machine, the surest first, and no more than the limit", () => {
    const pins = firstRunPins(machine, categories);
    const apps = pins.filter((p) => p.kind === "app").map((p) => (p.kind === "app" ? p.id : ""));
    expect(apps).toEqual(["Edge", "Explorer", "Word", "Excel", "Teams", "Code", "Krita", "Spotify"]);
    expect(apps.length).toBeLessThanOrEqual(FIRST_RUN_PINS);
    for (const id of apps) expect(machine.some((a) => a.id === id)).toBe(true);
  });

  it("makes a stack of every category that has apps, in category order, and none for the leftovers or empty ones", () => {
    const stacks = firstRunPins(machine, categories).flatMap((p) => (p.kind === "stack" ? [p.category] : []));
    expect(stacks).toEqual(["browsers", "productivity", "communication", "development", "creative", "media", "games", "system"]);
  });

  it("puts five real tiles on the right", () => {
    for (const id of FIRST_RUN_TILES) expect(isTileId(id)).toBe(true);
    expect(firstRunLayout(DEFAULT_SETTINGS, machine, categories, false)?.tiles).toEqual([...FIRST_RUN_TILES]);
  });

  it("only lays out a dock nobody has laid out, once, and only when the core has found apps", () => {
    expect(firstRunLayout(DEFAULT_SETTINGS, machine, categories, true)).toBeNull();
    expect(firstRunLayout(DEFAULT_SETTINGS, [], categories, false)).toBeNull();
    const laidOut: DockSettings = { ...DEFAULT_SETTINGS, tiles: ["clock"] };
    expect(firstRunLayout(laidOut, machine, categories, false)).toBeNull();
  });
});

describe("the first connection to the core", () => {
  it("lays out an empty dock from the machine's apps and remembers it did", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
    const { connectDock, setBackend } = await import("./bridge");
    const { useDockStore } = await import("./store");
    const saved: DockSettings[] = [];
    const ok = () => Promise.resolve({ ok: true } as const);
    setBackend({
      ready: () => Promise.resolve({ categories, apps: machine, windows: [], settings: DEFAULT_SETTINGS }),
      subscribe: () => Promise.resolve(() => undefined),
      launch: ok,
      activate: ok,
      closeWindow: ok,
      setCategory: ok,
      saveCategories: ok,
      setSettings: (settings) => {
        saved.push(settings);
        return ok();
      },
      setRegions: () => undefined,
      preview: () => undefined,
      setFocus: () => undefined,
    });
    await connectDock();
    const { pinned, tiles } = useDockStore.getState().settings;
    expect(pinned.length).toBeGreaterThan(8);
    expect(tiles).toEqual([...FIRST_RUN_TILES]);
    expect(saved).toHaveLength(1);
    expect(storage.get("dotdock.dock.seeded")).toBe("1");
  });
});

import { describe, expect, it, vi } from "vitest";
import { fitIconSize, ICON_LIMITS, isPopoverTile, LENGTH_RATIO, lengthOf, MAGNIFICATION_LIMITS, MENU, metricsFor, RATIO, TILE_POPOVER, TILE_POPOVER_SIZE } from "../geometry";
import { menuFor, type MenuContext } from "../menu";
import { buildEntries, isTileId, lengthKind, magnifyWeight, TILE_IDS, type BarEntry } from "../model";
import type { DockSettings } from "../protocol";
import { plural, t, type StringKey } from "../strings";

vi.stubGlobal("location", { search: "" });
const { useDockStore } = await import("../store");

const settings = (tiles: readonly string[]): DockSettings => ({
  schema: 1,
  enabled: true,
  replaceTaskbar: false,
  edge: "bottom",
  reserveSpace: true,
  autoHide: false,
  iconSize: 48,
  magnification: 1.25,
  pinned: [],
  tiles,
});

describe("every live tile is wired up", () => {
  it.each(TILE_IDS)("%s has a length, a name and a place on the bar", (id) => {
    expect(LENGTH_RATIO[id]).toBeDefined();
    expect(t(`tile.${id}` as StringKey)).not.toBe("");
    const entries = buildEntries({ categories: [], apps: [], windows: [], settings: { pinned: [], tiles: [id] } }, { now: 0, seen: new Set(), editing: false, status: false });
    const tile = entries.find((e): e is Extract<BarEntry, { kind: "tile" }> => e.kind === "tile");
    expect(tile?.id).toBe(id);
    expect(lengthKind(tile as BarEntry)).toBe(id);
    expect(magnifyWeight(tile as BarEntry)).toBe(0);
  });

  it("recognises exactly its own ids", () => {
    expect(TILE_IDS.every(isTileId)).toBe(true);
    expect(isTileId("weather")).toBe(false);
  });

  it("lets every tile be removed from its own menu", () => {
    const calls: string[] = [];
    const menu: MenuContext = {
      settings: settings([]),
      categories: [],
      apps: [],
      windows: [],
      editing: false,
      do: {
        launch: () => undefined,
        closeWindows: () => undefined,
        setCategory: () => undefined,
        updateSettings: (patch) => calls.push(JSON.stringify(patch)),
        openStack: () => undefined,
        setLibrary: () => undefined,
        setEditing: () => undefined,
        openGallery: () => undefined,
      },
    };
    for (const id of TILE_IDS) {
      menuFor(`tile:${id}`, { ...menu, settings: settings([id]) }).find((i) => i.id === "remove")?.run?.();
      expect(calls.at(-1)).toBe(JSON.stringify({ tiles: [] }));
    }
  });

  it("keeps all of them in the order the settings give, once each", () => {
    const entries = buildEntries(
      { categories: [], apps: [], windows: [], settings: { pinned: [], tiles: [...TILE_IDS].reverse().concat("clock") } },
      { now: 0, seen: new Set(), editing: false, status: false },
    );
    expect(entries.filter((e) => e.kind === "tile").map((e) => e.key)).toEqual([...TILE_IDS].reverse().map((id) => `tile:${id}`));
  });
});

describe("tile length on the dock", () => {
  it("is one item long on a vertical dock for every tile that has words beside its mark", () => {
    for (const id of ["agenda", "meeting", "focus", "stopwatch", "reminders", "progress", "contacts"] as const) {
      expect(LENGTH_RATIO[id][1]).toBe(1);
      expect(LENGTH_RATIO[id][0]).toBeGreaterThan(1);
    }
  });

  it("shrinks the whole dock to fit the screen with every tile on it", () => {
    const kinds = ["item", "item", "item", "divider", ...TILE_IDS.map((id) => lengthKind({ kind: "tile", key: id, id })), "divider", "status"] as const;
    const fitted = fitIconSize(64, kinds, 1280, false);
    expect(fitted).toBeLessThan(64);
    const used = kinds.reduce((sum, kind) => sum + lengthOf(kind, fitted, false), 0);
    expect(used).toBeLessThanOrEqual(1280);
  });
});

describe("tile popovers", () => {
  it("exist for the tiles that have more to show, and for no others", () => {
    expect(Object.keys(TILE_POPOVER_SIZE).sort()).toEqual(["agenda", "audio", "contacts", "focus", "hydration", "meeting", "progress", "reminders", "stopwatch", "system"]);
    for (const id of Object.keys(TILE_POPOVER_SIZE)) expect(isTileId(id)).toBe(true);
    for (const id of ["clock", "media", "mic"]) expect(isPopoverTile(id)).toBe(false);
  });

  it("have room for a header and a body inside every size", () => {
    for (const size of Object.values(TILE_POPOVER_SIZE)) {
      expect(size.h).toBeGreaterThan(TILE_POPOVER.head + 2 * TILE_POPOVER.pad);
      expect(size.w).toBeGreaterThan(MENU.w);
    }
  });

  it("fit a 1366 by 768 screen above a dock of the largest icon size, fully magnified", () => {
    const m = metricsFor(ICON_LIMITS.max);
    const below = m.bar + m.edge + (MAGNIFICATION_LIMITS.max - 1) * m.icon + RATIO.label * m.icon;
    for (const size of Object.values(TILE_POPOVER_SIZE)) {
      expect(size.h + TILE_POPOVER.gap + below).toBeLessThanOrEqual(768);
    }
  });
});

describe("opening a tile's popover", () => {
  const from = { x: 10, y: 10, w: 40, h: 40 };

  it("shuts a stack, a menu and the library out, and each of them shuts it", () => {
    const store = useDockStore.getState();
    store.openStack({ category: "media", from, fresh: new Set() });
    store.showTile({ id: "focus", from });
    expect(useDockStore.getState()).toMatchObject({ stack: null, menu: null, tile: { id: "focus" } });
    useDockStore.getState().setMenu({ key: null, at: { x: 0, y: 0 } });
    expect(useDockStore.getState().tile).toBeNull();
    useDockStore.getState().showTile({ id: "audio", from });
    useDockStore.getState().setLibrary(true);
    expect(useDockStore.getState().tile).toBeNull();
    useDockStore.getState().setLibrary(false);
    useDockStore.getState().showTile({ id: "audio", from });
    useDockStore.getState().openStack({ category: "media", from, fresh: new Set() });
    expect(useDockStore.getState().tile).toBeNull();
  });

  it("closes when edit mode starts, and closing with null leaves everything else alone", () => {
    const store = useDockStore.getState();
    store.openStack(null);
    store.showTile({ id: "stopwatch", from });
    store.setEditing(true);
    expect(useDockStore.getState().tile).toBeNull();
    store.setEditing(false);
    store.showTile({ id: "stopwatch", from });
    store.showTile(null);
    expect(useDockStore.getState().tile).toBeNull();
  });
});

describe("opening the widget gallery", () => {
  const from = { x: 10, y: 10, w: 40, h: 40 };

  it("shuts the other panels out, and each of them shuts it", () => {
    const store = useDockStore.getState();
    store.showTile({ id: "focus", from });
    store.showGallery({ from });
    expect(useDockStore.getState()).toMatchObject({ tile: null, stack: null, menu: null, libraryOpen: false, gallery: { from } });
    useDockStore.getState().showTile({ id: "audio", from });
    expect(useDockStore.getState().gallery).toBeNull();
    useDockStore.getState().showGallery({ from });
    useDockStore.getState().setLibrary(true);
    expect(useDockStore.getState().gallery).toBeNull();
    useDockStore.getState().showGallery({ from });
    useDockStore.getState().openStack({ category: "media", from, fresh: new Set() });
    expect(useDockStore.getState().gallery).toBeNull();
  });

  it("stays open while the dock is being edited, and closes with null", () => {
    const store = useDockStore.getState();
    store.showGallery({ from });
    store.setEditing(true);
    expect(useDockStore.getState().gallery).not.toBeNull();
    store.showGallery(null);
    store.setEditing(false);
    expect(useDockStore.getState().gallery).toBeNull();
  });
});

describe("the words", () => {
  it("have a hint for every reason a feed can be missing", () => {
    for (const issue of ["unsupported", "no-device", "offline", "error", "needs-setup"] as const) {
      expect(t(`tile.issue.${issue}`)).not.toBe("");
      expect(t(`tile.issue.${issue}.hint`)).not.toBe("");
    }
  });

  it("count open reminders", () => {
    expect(plural("tile.reminders.open", 1)).toBe("1 open");
    expect(plural("tile.reminders.open", 3)).toBe("3 open");
  });

  it("fill in the names", () => {
    expect(t("tile.contacts.act", { action: "Call", name: "Maya Okafor", app: "Phone Link" })).toBe("Call Maya Okafor with Phone Link");
    expect(t("tile.hydration.glass", { amount: "250 mL" })).toBe("Drink a glass, 250 mL");
  });
});

import { describe, expect, it } from "vitest";
import { actionable, heightBefore, menuFor, menuSize, type MenuActions, type MenuContext, type MenuItem } from "./menu";
import { MENU } from "./geometry";
import type { Category, DockApp, DockSettings, DockWindow } from "./protocol";

const categories: Category[] = [
  { id: "development", name: null, tone: "blue", order: 1 },
  { id: "media", name: "Listen", tone: "pink", order: 0 },
  { id: "games", name: null, tone: "green", order: 2 },
];
const app = (id: string, category: DockApp["category"]): DockApp => ({ id, name: id, category, filedBy: "known", icon: "", publisher: null, firstSeen: 0 });
const apps = [app("code", "development"), app("music", "media"), app("chess", "games")];
const win = (hwnd: string, appId: string | null, icon = "i"): DockWindow => ({ hwnd, appId, title: hwnd, icon, minimized: false, focused: false, flashing: false });

const settings: DockSettings = {
  schema: 1,
  enabled: true,
  replaceTaskbar: false,
  edge: "bottom",
  reserveSpace: true,
  autoHide: false,
  iconSize: 48,
  magnification: 1.25,
  pinned: [{ kind: "app", id: "code" }, { kind: "stack", category: "media" }],
  tiles: ["clock"],
};

function recorder(): { calls: string[]; actions: MenuActions } {
  const calls: string[] = [];
  return {
    calls,
    actions: {
      launch: (id) => calls.push(`launch ${id}`),
      closeWindows: (hwnds) => calls.push(`close ${hwnds.join(",")}`),
      setCategory: (id, c) => calls.push(`category ${id} ${c}`),
      updateSettings: (patch) => calls.push(`settings ${JSON.stringify(patch)}`),
      openStack: (c) => calls.push(`stack ${c}`),
      setLibrary: (open) => calls.push(`library ${open}`),
      setEditing: (editing) => calls.push(`editing ${editing}`),
      openGallery: () => calls.push("gallery"),
      openSettings: () => calls.push("settings panel"),
    },
  };
}

function context(over: Partial<MenuContext> = {}): { ctx: MenuContext; calls: string[] } {
  const { calls, actions } = recorder();
  return { calls, ctx: { settings, categories, apps, windows: [], editing: false, do: actions, ...over } };
}

const labels = (items: readonly MenuItem[]): string[] => items.filter((i) => i.kind !== "separator").map((i) => i.label);
const find = (items: readonly MenuItem[], id: string): MenuItem => {
  const item = items.find((i) => i.id === id);
  if (!item) throw new Error(`no ${id}`);
  return item;
};

describe("menuFor the bar", () => {
  it("offers the library and edit mode, and flips the edit entry while editing", () => {
    expect(labels(menuFor(null, context().ctx))).toEqual(["Arrange and remove", "Add a widget…", "Customise the dock…", "Show App Library"]);
    expect(labels(menuFor(null, context({ editing: true }).ctx))).toEqual(["Done editing", "Add a widget…", "Customise the dock…", "Show App Library"]);
  });

  it("runs the actions", () => {
    const { ctx, calls } = context();
    const items = menuFor(null, ctx);
    find(items, "library").run?.();
    find(items, "edit").run?.();
    expect(calls).toEqual(["library true", "editing true"]);
  });
});

describe("menuFor a pinned running app", () => {
  const running = [win("1", "code"), win("2", "code")];

  it("opens a new window, unpins, moves to a stack and closes every window", () => {
    const { ctx, calls } = context({ windows: running });
    const items = menuFor("app:code", ctx);
    expect(labels(items)).toEqual(["New window", "Remove from dock", "Move to stack", "Close all windows (2)", "Arrange and remove", "Add a widget…", "Customise the dock…"]);
    find(items, "open").run?.();
    find(items, "pin").run?.();
    find(items, "close").run?.();
    expect(calls).toEqual(["launch code", `settings ${JSON.stringify({ pinned: [{ kind: "stack", category: "media" }] })}`, "close 1,2"]);
  });

  it("says Close window for a single window", () => {
    expect(labels(menuFor("app:code", context({ windows: [win("1", "code")] }).ctx))).toContain("Close window");
  });

  it("lists every category under Move to stack, ticks the current one and files the app", () => {
    const { ctx, calls } = context();
    const move = find(menuFor("app:code", ctx), "move");
    expect(move.kind).toBe("submenu");
    expect(labels(move.children ?? [])).toEqual(["Listen", "Development", "Games"]);
    expect(move.children?.find((c) => c.checked)?.label).toBe("Development");
    move.children?.find((c) => c.id === "move:games")?.run?.();
    expect(calls).toEqual(["category code games"]);
  });
});

describe("menuFor an app that is not pinned", () => {
  it("offers to keep it in the dock", () => {
    const { ctx, calls } = context();
    const items = menuFor("app:chess", ctx);
    expect(labels(items)).toEqual(["Open", "Keep in dock", "Move to stack", "Arrange and remove", "Add a widget…", "Customise the dock…"]);
    find(items, "pin").run?.();
    expect(calls[0]).toContain('"app","id":"chess"');
  });
});

describe("menuFor stacks, tiles and windows without an entry", () => {
  it("opens or removes a stack", () => {
    const { ctx, calls } = context();
    const items = menuFor("stack:media", ctx);
    find(items, "open").run?.();
    find(items, "remove").run?.();
    expect(calls).toEqual(["stack media", `settings ${JSON.stringify({ pinned: [{ kind: "app", id: "code" }] })}`]);
  });

  it("removes a tile and ignores unknown tile ids", () => {
    const { ctx, calls } = context();
    find(menuFor("tile:clock", ctx), "remove").run?.();
    expect(calls).toEqual([`settings ${JSON.stringify({ tiles: [] })}`]);
    expect(labels(menuFor("tile:weather", ctx))).toEqual(["Arrange and remove", "Add a widget…", "Customise the dock…", "Show App Library"]);
  });

  it("closes a group of windows that has no Start menu entry", () => {
    const { ctx, calls } = context({ windows: [win("9", null, "x"), win("10", null, "x")] });
    const items = menuFor("exe:x", ctx);
    expect(labels(items)).toEqual(["Close all windows (2)", "Arrange and remove", "Add a widget…", "Customise the dock…"]);
    find(items, "close").run?.();
    expect(calls).toEqual(["close 9,10"]);
  });

  it("falls back to the bar menu for unknown keys", () => {
    expect(labels(menuFor("app:gone", context().ctx))).toEqual(["Arrange and remove", "Add a widget…", "Customise the dock…", "Show App Library"]);
  });
});

describe("the add widget entry", () => {
  it("opens the gallery from the bar's menu", () => {
    const { ctx, calls } = context();
    find(menuFor(null, ctx), "widgets").run?.();
    expect(calls).toEqual(["gallery"]);
  });
});

describe("the dock settings entry", () => {
  it("opens the settings popover from the bar's menu", () => {
    const { ctx, calls } = context();
    find(menuFor(null, ctx), "settings").run?.();
    expect(calls).toEqual(["settings panel"]);
  });
});

describe("the dock's own entries", () => {
  it("end every item's menu, after a separator, so they are found from any right-click", () => {
    const { ctx, calls } = context();
    for (const key of ["app:code", "stack:media", "tile:clock"]) {
      const items = menuFor(key, ctx);
      const at = items.findIndex((i) => i.id === "s-dock");
      expect(items[at]?.kind).toBe("separator");
      expect(items.slice(at + 1).map((i) => i.id)).toEqual(["edit", "widgets", "settings"]);
    }
    find(menuFor("tile:clock", ctx), "widgets").run?.();
    expect(calls).toContain("gallery");
  });
});

describe("menu size", () => {
  it("adds up the row heights and finds the rows the keyboard can land on", () => {
    const items: MenuItem[] = [
      { id: "h", label: "H", kind: "heading" },
      { id: "a", label: "A", kind: "item" },
      { id: "s", label: "", kind: "separator" },
      { id: "b", label: "B", kind: "submenu" },
    ];
    expect(actionable(items)).toEqual([1, 3]);
    expect(heightBefore(items, 2)).toBe(MENU.heading + MENU.row);
    expect(menuSize(items).h).toBe(MENU.heading + 2 * MENU.row + MENU.separator + 2 * MENU.pad);
    expect(menuSize(items).w).toBe(MENU.w);
  });
});

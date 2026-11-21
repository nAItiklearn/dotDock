import { describe, expect, it } from "vitest";
import {
  activationTarget,
  appsInCategory,
  buildEntries,
  categoriesWithApps,
  FIRST_SCAN_THRESHOLD,
  freshAppIds,
  groupWindows,
  indicatorFor,
  NEW_APP_WINDOW_MS,
  pin,
  pinKey,
  pinOf,
  reorderBy,
  tileKey,
  unpin,
  type BarEntry,
  type BuildInput,
} from "./model";
import type { Category, DockApp, DockWindow } from "./protocol";

const NOW = 1_800_000_000_000;

const app = (id: string, category: DockApp["category"], extra: Partial<DockApp> = {}): DockApp => ({
  id,
  name: id,
  category,
  filedBy: "known",
  icon: `icon:${id}`,
  publisher: null,
  firstSeen: NOW - 30 * NEW_APP_WINDOW_MS,
  ...extra,
});

const win = (hwnd: string, appId: string | null, extra: Partial<DockWindow> = {}): DockWindow => ({
  hwnd,
  appId,
  title: `Window ${hwnd}`,
  icon: appId === null ? `exe:${hwnd}` : `icon:${appId}`,
  minimized: false,
  focused: false,
  flashing: false,
  ...extra,
});

const categories: Category[] = [
  { id: "development", name: null, tone: "blue", order: 0 },
  { id: "media", name: "Listen", tone: "pink", order: 1 },
  { id: "games", name: null, tone: "green", order: 2 },
];

const apps = [app("code", "development"), app("term", "development"), app("music", "media"), app("alpha", "development")];

const input = (over: Partial<BuildInput["settings"]> = {}, windows: DockWindow[] = []): BuildInput => ({
  categories,
  apps,
  windows,
  settings: { pinned: [], tiles: [], ...over },
});

const options = { now: NOW, seen: new Set<string>(), editing: false, status: true };
const keys = (entries: BarEntry[]): string[] => entries.map((e) => e.key);

describe("buildEntries", () => {
  it("orders library, pinned items, running apps, tiles and status with dividers between non-empty sections", () => {
    const entries = buildEntries(
      input({ pinned: [{ kind: "app", id: "code" }, { kind: "stack", category: "media" }], tiles: ["clock"] }, [win("1", "term"), win("2", null)]),
      options,
    );
    expect(keys(entries)).toEqual(["library", "app:code", "stack:media", "divider:0", "app:term", "exe:exe:2", "divider:1", "tile:clock", "divider:2", "status", "more"]);
  });

  it("leaves out empty sections instead of drawing double dividers", () => {
    const entries = buildEntries(input({ pinned: [{ kind: "app", id: "code" }] }), { ...options, status: false });
    expect(keys(entries)).toEqual(["library", "app:code", "more"]);
  });

  it("drops pinned items whose app or category is gone, and unknown tile ids", () => {
    const entries = buildEntries(
      input({ pinned: [{ kind: "app", id: "uninstalled" }, { kind: "stack", category: "custom:gone" }], tiles: ["stocks", "clock", "clock"] }),
      { ...options, status: false },
    );
    expect(keys(entries)).toEqual(["library", "divider:0", "tile:clock", "more"]);
  });

  it("shows a running pinned app once, with its windows", () => {
    const entries = buildEntries(input({ pinned: [{ kind: "app", id: "code" }] }, [win("7", "code"), win("8", "code")]), options);
    const code = entries.find((e) => e.key === "app:code");
    expect(code?.kind === "app" && code.windows.length).toBe(2);
    expect(entries.filter((e) => e.kind === "app")).toHaveLength(1);
  });

  it("previews at most four apps in a stack, by name, and counts running and new ones", () => {
    const many = Array.from({ length: 7 }, (_, i) => app(`dev${i}`, "games"));
    const entries = buildEntries(
      { ...input({ pinned: [{ kind: "stack", category: "games" }] }, [win("1", "dev3")]), apps: many },
      options,
    );
    const stack = entries.find((e) => e.kind === "stack");
    if (stack?.kind !== "stack") throw new Error("no stack");
    expect(stack.preview.map((a) => a.id)).toEqual(["dev0", "dev1", "dev2", "dev3"]);
    expect(stack.apps).toHaveLength(7);
    expect(stack.running).toBe(1);
  });

  it("uses the user's category name, else the built-in label", () => {
    const entries = buildEntries(input({ pinned: [{ kind: "stack", category: "media" }, { kind: "stack", category: "development" }] }), options);
    const labels = entries.flatMap((e) => (e.kind === "stack" ? [e.label] : []));
    expect(labels).toEqual(["Listen", "Development"]);
  });

  it("adds the add tile in edit mode", () => {
    const entries = buildEntries(input({ pinned: [{ kind: "app", id: "code" }] }), { ...options, editing: true, status: false });
    expect(keys(entries)).toEqual(["library", "app:code", "add", "more"]);
  });
});

describe("groupWindows", () => {
  it("groups by app and keeps windows with no entry together by their executable icon", () => {
    const byId = new Map(apps.map((a) => [a.id, a]));
    const groups = groupWindows([win("1", "code"), win("2", null, { icon: "exe:x" }), win("3", "code"), win("4", null, { icon: "exe:x" })], byId);
    expect(groups.map((g) => [g.key, g.windows.length])).toEqual([
      ["app:code", 2],
      ["exe:exe:x", 2],
    ]);
    expect(groups[1]?.appId).toBeNull();
  });
});

describe("freshAppIds", () => {
  const recent = (id: string): DockApp => app(id, "other", { firstSeen: NOW - 1000 });
  it("badges recent installs that were not acknowledged", () => {
    const fresh = freshAppIds([recent("a"), recent("b"), app("old", "other")], new Set(["b"]), NOW);
    expect([...fresh]).toEqual(["a"]);
  });
  it("badges nothing after a first scan that found a crowd of new apps", () => {
    const crowd = Array.from({ length: FIRST_SCAN_THRESHOLD + 1 }, (_, i) => recent(`a${i}`));
    expect(freshAppIds(crowd, new Set(), NOW).size).toBe(0);
  });
  it("ignores first-seen times in the future", () => {
    expect(freshAppIds([app("x", "other", { firstSeen: NOW + 5000 })], new Set(), NOW).size).toBe(0);
  });
});

describe("indicatorFor", () => {
  it("shows no dot, one dot, or two dots, and marks focus and attention", () => {
    expect(indicatorFor([])).toEqual({ dots: 0, focused: false, attention: false });
    expect(indicatorFor([win("1", "code")]).dots).toBe(1);
    const many = indicatorFor([win("1", "code"), win("2", "code", { focused: true, flashing: true })]);
    expect(many).toEqual({ dots: 2, focused: true, attention: true });
  });
});

describe("activationTarget", () => {
  it("picks nothing for no windows and the only window otherwise", () => {
    expect(activationTarget([])).toBeNull();
    expect(activationTarget([win("1", "code", { focused: true })])?.hwnd).toBe("1");
  });
  it("cycles to the window after the focused one", () => {
    const ws = [win("1", "code"), win("2", "code", { focused: true }), win("3", "code")];
    expect(activationTarget(ws)?.hwnd).toBe("3");
    expect(activationTarget([win("1", "code"), win("2", "code"), win("3", "code", { focused: true })])?.hwnd).toBe("1");
  });
  it("prefers a window that is not minimised when none is focused", () => {
    expect(activationTarget([win("1", "code", { minimized: true }), win("2", "code")])?.hwnd).toBe("2");
    expect(activationTarget([win("1", "code", { minimized: true }), win("2", "code", { minimized: true })])?.hwnd).toBe("1");
  });
});

describe("pinning", () => {
  it("pins once, unpins, and identifies what an entry stands for", () => {
    const a = { kind: "app", id: "code" } as const;
    const s = { kind: "stack", category: "media" } as const;
    expect(pin(pin([], a), a)).toEqual([a]);
    expect(unpin([a, s], a)).toEqual([s]);
    const entries = buildEntries(input({ pinned: [a, s] }), options);
    expect(entries.map(pinOf)).toContainEqual(a);
    expect(entries.map(pinOf)).toContainEqual(s);
    expect(pinOf({ kind: "divider", key: "d" })).toBeNull();
  });
});

describe("reorderBy", () => {
  const items = [{ k: "a" }, { k: "b" }, { k: "gone" }, { k: "c" }];
  const key = (i: { k: string }): string => i.k;

  it("puts the listed items in the given order, in the places those items hold", () => {
    expect(reorderBy(items, key, ["c", "a", "b"]).map(key)).toEqual(["c", "a", "gone", "b"]);
  });

  it("leaves items that are not listed where they are, and ignores keys that do not exist", () => {
    expect(reorderBy(items, key, ["b", "zzz", "a"]).map(key)).toEqual(["b", "a", "gone", "c"]);
  });

  it("is the identity for the current order", () => {
    expect(reorderBy(items, key, ["a", "b", "c"])).toEqual(items);
  });

  it("maps pinned items and tiles to the keys the bar uses", () => {
    expect(pinKey({ kind: "app", id: "x" })).toBe("app:x");
    expect(pinKey({ kind: "stack", category: "media" })).toBe("stack:media");
    expect(tileKey("clock")).toBe("tile:clock");
  });
});

describe("category helpers", () => {
  it("lists a category's apps by name and only categories that have apps", () => {
    expect(appsInCategory(apps, "development").map((a) => a.id)).toEqual(["alpha", "code", "term"]);
    expect(categoriesWithApps(categories, apps).map((c) => c.id)).toEqual(["development", "media"]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_WIDGET_META } from "../../overlay/widgetMeta";
import { DEFAULT_SETTINGS, defaultLayoutDoc } from "../model/defaults";
import { parseBackup, serializeBackup } from "../model/backup";
import type { Placement } from "../model/types";
import { MemoryBackend } from "../storage/backend";
import { themeToDoc } from "../theme/schema";
import { PAPER } from "../../design-system/themes";
import { createApp, displayFromLocation, type AppContext } from "./app";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function boot(backend = new MemoryBackend(), overrides: { monitorId?: string; isPrimary?: boolean } = {}): Promise<AppContext> {
  const bus = { send: () => undefined, subscribe: () => () => undefined };
  const app = createApp({ catalog: BUILT_IN_WIDGET_META, backend, bus, ...overrides });
  await app.start();
  app.layout.getState().setBounds({ cols: 16, rows: 9 });
  return app;
}

const layout = (app: AppContext) => app.layout.getState();
const settings = (app: AppContext) => app.settings.getState();
const ids = (ps: readonly Placement[]): string[] => ps.map((p) => p.id);

describe("first run", () => {
  it("shows the Work profile on the primary display", async () => {
    const app = await boot();
    expect(settings(app).settings).toEqual(DEFAULT_SETTINGS);
    expect(layout(app).profileId).toBe("work");
    expect(layout(app).placements).toEqual(defaultLayoutDoc("work").monitors["primary"]?.placements);
  });

  it("writes nothing to storage until something changes", async () => {
    const backend = new MemoryBackend();
    await boot(backend);
    await vi.advanceTimersByTimeAsync(2000);
    expect(backend.names).toEqual([]);
  });

  it("reads the display from the URL parameters the core sets", () => {
    expect(displayFromLocation("")).toEqual({ monitorId: "primary", isPrimary: true });
    expect(displayFromLocation("?monitor=DISPLAY2&primary=1")).toEqual({ monitorId: "DISPLAY2", isPrimary: true });
    expect(displayFromLocation("?monitor=DISPLAY2")).toEqual({ monitorId: "DISPLAY2", isPrimary: false });
  });

  it("a secondary display starts empty, not with a copy of the primary's widgets", async () => {
    const backend = new MemoryBackend();
    const app = await boot(backend, { monitorId: "DISPLAY2", isPrimary: false });
    expect(layout(app).placements).toEqual([]);
  });

  it("the primary display under a real id inherits the generic primary layout", async () => {
    const app = await boot(new MemoryBackend(), { monitorId: "DISPLAY1", isPrimary: true });
    expect(layout(app).placements).toHaveLength(8);
  });
});

describe("edit session", () => {
  it("only edits while in edit mode", async () => {
    const app = await boot();
    expect(layout(app).moveTo("ram-1", { x: 10, y: 0 })).toEqual({ ok: false, reason: "unknown" });
    expect(layout(app).placements.find((p) => p.id === "ram-1")).toMatchObject({ x: 0, y: 4 });
  });

  it("moves, undoes and redoes", async () => {
    const app = await boot();
    layout(app).enterEdit();
    expect(layout(app).moveTo("ram-1", { x: 10, y: 0 })).toEqual({ ok: true });
    expect(layout(app).placements.find((p) => p.id === "ram-1")).toMatchObject({ x: 10, y: 0 });
    expect(layout(app).canUndo).toBe(true);
    layout(app).undo();
    expect(layout(app).placements.find((p) => p.id === "ram-1")).toMatchObject({ x: 0, y: 4 });
    expect(layout(app).canRedo).toBe(true);
    layout(app).redo();
    expect(layout(app).placements.find((p) => p.id === "ram-1")).toMatchObject({ x: 10, y: 0 });
  });

  it("keeps 50 undo steps and no more", async () => {
    const app = await boot();
    layout(app).enterEdit();
    for (let i = 0; i < 60; i++) layout(app).moveTo("ram-1", { x: 8 + (i % 2), y: 0 });
    let steps = 0;
    while (layout(app).canUndo) {
      layout(app).undo();
      steps++;
    }
    expect(steps).toBe(50);
  });

  it("saves when edit mode is left, and only then clears the session", async () => {
    const backend = new MemoryBackend();
    const app = await boot(backend);
    layout(app).enterEdit("ram-1");
    layout(app).moveTo("ram-1", { x: 10, y: 0 });
    await layout(app).exitEdit();
    expect(layout(app).editing).toBe(false);
    expect(layout(app).canUndo).toBe(false);
    const saved = JSON.parse((await backend.read("layouts/work")) ?? "{}");
    expect(saved.schema).toBe(2);
    expect(saved.monitors.primary.placements.find((p: Placement) => p.id === "ram-1")).toMatchObject({ x: 10, y: 0 });
  });

  it("autosaves shortly after an edit, so a crash mid-edit loses little", async () => {
    const backend = new MemoryBackend();
    const app = await boot(backend);
    layout(app).enterEdit();
    layout(app).moveTo("ram-1", { x: 10, y: 0 });
    expect(await backend.read("layouts/work")).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(await backend.read("layouts/work")).not.toBeNull();
  });

  it("does not write anything when edit mode is entered and left without changes", async () => {
    const backend = new MemoryBackend();
    const app = await boot(backend);
    layout(app).enterEdit();
    await layout(app).exitEdit();
    expect(backend.names).toEqual([]);
  });

  it("persists across a reload", async () => {
    const backend = new MemoryBackend();
    const first = await boot(backend);
    layout(first).enterEdit();
    layout(first).moveTo("ram-1", { x: 10, y: 0 });
    layout(first).remove("disk-1");
    await layout(first).exitEdit();
    const second = await boot(backend);
    expect(layout(second).placements.find((p) => p.id === "ram-1")).toMatchObject({ x: 10, y: 0 });
    expect(ids(layout(second).placements)).not.toContain("disk-1");
  });

  it("adds, duplicates and removes, selecting what it creates", async () => {
    const app = await boot();
    layout(app).enterEdit();
    const added = layout(app).addWidget("clock", "s");
    expect(added.ok).toBe(true);
    expect(layout(app).selectedId).toBe("clock-2");
    const copy = layout(app).duplicate("clock-2");
    expect(copy).toEqual({ ok: true, id: "clock-3" });
    layout(app).remove("clock-3");
    expect(ids(layout(app).placements)).not.toContain("clock-3");
    // The removed widget was the selected one, so nothing is selected any more.
    expect(layout(app).selectedId).toBeNull();
  });

  it("clears the selection when undo removes the selected widget", async () => {
    const app = await boot();
    layout(app).enterEdit();
    layout(app).addWidget("clock", "s");
    layout(app).undo();
    expect(layout(app).selectedId).toBeNull();
  });

  it("tells the user when there is no room instead of failing silently", async () => {
    const app = await boot();
    app.layout.getState().setBounds({ cols: 6, rows: 4 });
    layout(app).enterEdit();
    const result = layout(app).addWidget("calendar");
    expect(result).toEqual({ ok: false, reason: "no-room" });
    expect(app.notices.getState().notices.at(-1)?.key).toBe("layout:no-room");
  });

  it("resizes through declared sizes and steps up and down", async () => {
    const app = await boot();
    layout(app).enterEdit();
    expect(layout(app).resizeTo("clock-1", "l")).toEqual({ ok: true });
    expect(layout(app).placements.find((p) => p.id === "clock-1")?.size).toBe("l");
    expect(layout(app).stepSize("clock-1", -1)).toEqual({ ok: true });
    expect(layout(app).placements.find((p) => p.id === "clock-1")?.size).toBe("m");
    expect(layout(app).stepSize("ram-1", 1)).toEqual({ ok: false, reason: "unknown" });
  });

  it("coalesces a slider drag into one undo step", async () => {
    const app = await boot();
    layout(app).enterEdit();
    layout(app).patchConfig("clock-1", { blinkColon: true });
    layout(app).patchConfig("clock-1", { blinkColon: false });
    layout(app).patchConfig("clock-1", { blinkColon: true });
    layout(app).undo();
    expect(layout(app).canUndo).toBe(false);
    expect(layout(app).placements.find((p) => p.id === "clock-1")?.config["blinkColon"]).toBe(false);
  });

  it("lock mode refuses every change", async () => {
    const app = await boot();
    settings(app).update((s) => ({ ...s, layout: { ...s.layout, locked: true } }));
    layout(app).enterEdit();
    for (const result of [
      layout(app).moveTo("ram-1", { x: 10, y: 0 }),
      layout(app).addWidget("clock"),
      layout(app).remove("ram-1"),
      layout(app).duplicate("ram-1"),
      layout(app).resizeTo("clock-1", "l"),
      layout(app).patchConfig("clock-1", { hour24: false }),
    ]) {
      expect(result).toEqual({ ok: false, reason: "locked" });
    }
    expect(layout(app).placements).toEqual(defaultLayoutDoc("work").monitors["primary"]?.placements);
  });

  it("swap mode swaps instead of pushing", async () => {
    const app = await boot();
    settings(app).update((s) => ({ ...s, layout: { ...s.layout, collision: "swap" } }));
    layout(app).enterEdit();
    layout(app).moveTo("ram-1", { x: 2, y: 4 });
    expect(layout(app).placements.find((p) => p.id === "disk-1")).toMatchObject({ x: 0, y: 4 });
  });

  it("refits a stored layout to a smaller display without touching what is stored", async () => {
    const backend = new MemoryBackend();
    const app = await boot(backend);
    layout(app).enterEdit();
    layout(app).moveTo("date-circle-1", { x: 14, y: 7 });
    await layout(app).exitEdit();
    const small = await boot(backend);
    small.layout.getState().setBounds({ cols: 8, rows: 5 });
    const date = small.layout.getState().placements.find((p) => p.id === "date-circle-1");
    expect((date?.x ?? 99) + 2).toBeLessThanOrEqual(8);
    expect((date?.y ?? 99) + 2).toBeLessThanOrEqual(5);
    expect(JSON.parse((await backend.read("layouts/work")) ?? "{}").monitors.primary.placements.find((p: Placement) => p.id === "date-circle-1")).toMatchObject({ x: 14, y: 7 });
  });

  it("two displays saving at once do not erase each other", async () => {
    const backend = new MemoryBackend();
    const left = await boot(backend, { monitorId: "L", isPrimary: false });
    const right = await boot(backend, { monitorId: "R", isPrimary: false });
    layout(left).enterEdit();
    layout(right).enterEdit();
    layout(left).addWidget("clock", "s");
    layout(right).addWidget("calendar");
    await Promise.all([layout(left).exitEdit(), layout(right).exitEdit()]);
    const doc = JSON.parse((await backend.read("layouts/work")) ?? "{}");
    expect(doc.monitors.L.placements).toHaveLength(1);
    expect(doc.monitors.R.placements).toHaveLength(1);
  });

  it("follows a profile switch made elsewhere", async () => {
    const app = await boot();
    settings(app).setActiveProfile("minimal");
    await vi.advanceTimersByTimeAsync(10);
    expect(layout(app).profileId).toBe("minimal");
    expect(ids(layout(app).placements)).toEqual(["clock-1"]);
  });

  it("leaves edit mode (saving) when the profile changes under it", async () => {
    const backend = new MemoryBackend();
    const app = await boot(backend);
    layout(app).enterEdit();
    layout(app).moveTo("ram-1", { x: 10, y: 0 });
    settings(app).setActiveProfile("focus");
    await vi.advanceTimersByTimeAsync(10);
    expect(layout(app).editing).toBe(false);
    expect(JSON.parse((await backend.read("layouts/work")) ?? "{}").monitors.primary.placements.find((p: Placement) => p.id === "ram-1")).toMatchObject({ x: 10 });
  });

  it("reloads when another window changes the layout, but not mid-edit", async () => {
    const backend = new MemoryBackend();
    const app = await boot(backend);
    const edited = { ...defaultLayoutDoc("work"), monitors: { primary: { placements: [{ id: "clock-1", kind: "clock", size: "s", x: 3, y: 3, config: {} }] } } };
    backend.externalWrite("layouts/work", JSON.stringify(edited));
    await vi.advanceTimersByTimeAsync(10);
    expect(ids(layout(app).placements)).toEqual(["clock-1"]);
    layout(app).enterEdit();
    backend.externalWrite("layouts/work", JSON.stringify(defaultLayoutDoc("work")));
    await vi.advanceTimersByTimeAsync(10);
    expect(ids(layout(app).placements)).toEqual(["clock-1"]);
  });
});

describe("settings", () => {
  it("clamps changes into range and persists after the debounce", async () => {
    const backend = new MemoryBackend();
    const app = await boot(backend);
    settings(app).update((s) => ({ ...s, layout: { ...s.layout, gap: 999 } }));
    expect(settings(app).settings.layout.gap).toBe(20);
    expect(await backend.read("settings")).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    expect(JSON.parse((await backend.read("settings")) ?? "{}").layout.gap).toBe(20);
  });

  it("writes once for a burst of changes", async () => {
    const backend = new MemoryBackend();
    const writes: string[] = [];
    const original = backend.write.bind(backend);
    backend.write = (n, t) => {
      writes.push(n);
      return original(n, t);
    };
    const app = await boot(backend);
    for (let gap = 8; gap <= 20; gap += 2) settings(app).update((s) => ({ ...s, layout: { ...s.layout, gap } }));
    await vi.advanceTimersByTimeAsync(300);
    expect(writes.filter((n) => n === "settings")).toHaveLength(1);
  });

  it("flush writes immediately", async () => {
    const backend = new MemoryBackend();
    const app = await boot(backend);
    settings(app).update((s) => ({ ...s, appearance: { ...s.appearance, font: "mono" } }));
    await settings(app).flush();
    expect(JSON.parse((await backend.read("settings")) ?? "{}").appearance.font).toBe("mono");
  });

  it("ignores a change that does not change anything", async () => {
    const backend = new MemoryBackend();
    const app = await boot(backend);
    settings(app).update((s) => s);
    await vi.advanceTimersByTimeAsync(500);
    expect(backend.names).toEqual([]);
  });

  it("picks up changes made in another window", async () => {
    const backend = new MemoryBackend();
    const app = await boot(backend);
    backend.externalWrite("settings", JSON.stringify({ ...DEFAULT_SETTINGS, theme: { ...DEFAULT_SETTINGS.theme, fixedId: "aurum" } }));
    await vi.advanceTimersByTimeAsync(10);
    expect(settings(app).settings.theme.fixedId).toBe("aurum");
  });

  it("cycles through profiles", async () => {
    const app = await boot();
    settings(app).nextProfile();
    expect(settings(app).settings.activeProfileId).toBe("focus");
    settings(app).nextProfile();
    settings(app).nextProfile();
    expect(settings(app).settings.activeProfileId).toBe("work");
  });
});

describe("profiles", () => {
  it("creates a profile as a copy of the current one", async () => {
    const app = await boot();
    const id = await settings(app).createProfile("Evening", "current");
    expect(id).toBe("evening");
    expect(settings(app).settings.activeProfileId).toBe("evening");
    await vi.advanceTimersByTimeAsync(10);
    expect(layout(app).profileId).toBe("evening");
    expect(layout(app).placements).toHaveLength(8);
  });

  it("creates an empty profile", async () => {
    const app = await boot();
    await settings(app).createProfile("Blank", "empty");
    await vi.advanceTimersByTimeAsync(10);
    expect(layout(app).placements).toEqual([]);
  });

  it("gives duplicate names unique ids and refuses blank names", async () => {
    const app = await boot();
    expect(await settings(app).createProfile("Desk", "empty")).toBe("desk");
    expect(await settings(app).createProfile("Desk", "empty")).toBe("desk-2");
    expect(await settings(app).createProfile("   ", "empty")).toBeNull();
  });

  it("deletes a user profile and can bring it back", async () => {
    const app = await boot();
    await settings(app).createProfile("Evening", "current");
    const restore = await settings(app).deleteProfile("evening");
    expect(restore).not.toBeNull();
    expect(settings(app).settings.profiles.map((p) => p.id)).not.toContain("evening");
    expect(settings(app).settings.activeProfileId).toBe("work");
    await restore?.();
    expect(settings(app).settings.profiles.map((p) => p.id)).toContain("evening");
    expect((await app.repo.load("evening")).monitors["primary"]?.placements).toHaveLength(8);
  });

  it("refuses to delete a built-in profile", async () => {
    const app = await boot();
    expect(await settings(app).deleteProfile("work")).toBeNull();
  });

  it("renames", async () => {
    const app = await boot();
    settings(app).renameProfile("work", "Desk");
    expect(settings(app).settings.profiles[0]?.name).toBe("Desk");
  });
});

describe("custom themes", () => {
  const ember = () => ({ ...themeToDoc(PAPER, "custom-ember", "Ember") });

  it("saves, persists and reloads a custom theme", async () => {
    const backend = new MemoryBackend();
    const app = await boot(backend);
    settings(app).saveTheme(ember());
    await settings(app).flush();
    expect(await backend.read("themes/custom-ember")).not.toBeNull();
    const again = await boot(backend);
    expect(settings(again).customThemes.map((t) => t.id)).toEqual(["custom-ember"]);
  });

  it("updates in place when the id already exists", async () => {
    const app = await boot();
    settings(app).saveTheme(ember());
    settings(app).saveTheme({ ...ember(), name: "Ember 2" });
    expect(settings(app).customThemes).toHaveLength(1);
    expect(settings(app).customThemes[0]?.name).toBe("Ember 2");
  });

  it("falls back to the default theme everywhere the deleted one was selected", async () => {
    const app = await boot();
    settings(app).saveTheme(ember());
    settings(app).update((s) => ({ ...s, theme: { ...s.theme, mode: "system", fixedId: "custom-ember", lightId: "custom-ember" } }));
    settings(app).deleteTheme("custom-ember");
    expect(settings(app).customThemes).toEqual([]);
    expect(settings(app).settings.theme).toMatchObject({ fixedId: "obsidian", lightId: "paper", darkId: "obsidian" });
  });

  it("imports a file under a fresh id and rejects a bad one with reasons", async () => {
    const app = await boot();
    settings(app).saveTheme(ember());
    const text = JSON.stringify(ember());
    const result = settings(app).importTheme(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.theme.id).toBe("custom-ember-2");
    const bad = settings(app).importTheme("{}");
    expect(bad.ok).toBe(false);
  });

  it("caps the number of custom themes", async () => {
    const app = await boot();
    for (let i = 0; i < 30; i++) settings(app).saveTheme({ ...ember(), id: `custom-t${i}`, name: `T${i}` });
    expect(settings(app).customThemes).toHaveLength(24);
  });
});

describe("backup, restore and reset", () => {
  it("exports everything and imports it into a clean install", async () => {
    const source = await boot();
    settings(source).update((s) => ({ ...s, theme: { ...s.theme, fixedId: "custom-ember" } }));
    settings(source).saveTheme(themeToDoc(PAPER, "custom-ember", "Ember"));
    await settings(source).createProfile("Evening", "current");
    await vi.advanceTimersByTimeAsync(10);
    layout(source).enterEdit();
    layout(source).remove("ram-1");
    await layout(source).exitEdit();
    const text = serializeBackup(await settings(source).exportBundle({ name: "dotDock", version: "0.1.0" }));

    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.skipped).toEqual([]);

    const target = await boot();
    await settings(target).applyBundle(parsed.bundle);
    expect(settings(target).settings.theme.fixedId).toBe("custom-ember");
    expect(settings(target).customThemes.map((t) => t.id)).toEqual(["custom-ember"]);
    const evening = await target.repo.load("evening");
    expect(evening.monitors["primary"]?.placements.map((p) => p.id)).not.toContain("ram-1");
  });

  it("resets settings, themes and layouts to the shipped state", async () => {
    const backend = new MemoryBackend();
    const app = await boot(backend);
    settings(app).saveTheme(themeToDoc(PAPER, "custom-ember", "Ember"));
    await settings(app).createProfile("Evening", "current");
    layout(app).enterEdit();
    layout(app).remove("ram-1");
    await layout(app).exitEdit();
    await settings(app).resetAll();
    expect(settings(app).settings).toEqual(DEFAULT_SETTINGS);
    expect(settings(app).customThemes).toEqual([]);
    expect((await app.repo.load("work")).monitors["primary"]?.placements).toHaveLength(8);
    expect(await backend.read("layouts/evening")).toBeNull();
    expect(await backend.read("themes/custom-ember")).toBeNull();
  });
});

describe("backup files", () => {
  it("reject things that are not backups", () => {
    expect(parseBackup("nope").ok).toBe(false);
    expect(parseBackup("{}").ok).toBe(false);
    expect(parseBackup(JSON.stringify({ kind: "dotdock-backup", schema: 9 })).ok).toBe(false);
    expect(parseBackup("x".repeat(3 * 1024 * 1024)).ok).toBe(false);
  });

  it("import what they can and name what they skipped", () => {
    const result = parseBackup(
      JSON.stringify({
        kind: "dotdock-backup",
        schema: 1,
        settings: { layout: { gap: 14 } },
        layouts: { work: { schema: 1, placements: [{ id: "clock-1", kind: "clock", x: 0, y: 0, config: { height: 40 } }] }, broken: "x", "bad id": {} },
        themes: [{ nope: true }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.settings.layout.gap).toBe(14);
    expect(result.bundle.layouts["work"]?.monitors["primary"]?.placements[0]?.size).toBe("s");
    expect(result.skipped).toHaveLength(3);
    expect(result.bundle.themes).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBackend } from "../lib/storage/backend";
import { createApp, type AppContext } from "../lib/state/app";
import { widgetCatalog } from "./catalog";
import { addOrigin, removeWithExit, widgetMenuItems, type MenuTarget, type RemoveDeps } from "./directActions";
import { editUi, resetEditUi } from "./editUi";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  resetEditUi();
});

async function boot(): Promise<AppContext> {
  const bus = { send: () => undefined, subscribe: () => () => undefined };
  const app = createApp({ catalog: widgetCatalog, backend: new MemoryBackend(), bus });
  await app.start();
  app.layout.getState().setBounds({ cols: 16, rows: 9 });
  return app;
}

function target(app: AppContext, id: string, locked = false): MenuTarget {
  const p = app.layout.getState().placements.find((x) => x.id === id);
  const meta = p ? widgetCatalog.get(p.widget) : undefined;
  if (!p || !meta) throw new Error(`no widget ${id}`);
  return { id, name: meta.name, sizes: meta.sizes, size: p.size, locked, at: { x: 1, y: 7 } };
}

const noDom = (locked = false): RemoveDeps => ({ locked: () => locked, element: () => null, exit: async () => undefined });

describe("right-click menu on a widget", () => {
  it("offers every size preset with the current one checked", async () => {
    const app = await boot();
    const t = target(app, "system-1");
    const sizes = widgetMenuItems(t, app.layout).filter((i) => i.id.startsWith("size-"));
    expect(sizes.length).toBe(t.sizes.length);
    expect(sizes.filter((i) => i.checked).map((i) => i.id)).toEqual([`size-${t.size}`]);
  });

  it("resizes from a preset, inside edit mode so it can be undone", async () => {
    const app = await boot();
    const t = target(app, "system-1");
    const other = t.sizes.find((s) => s.id !== t.size);
    if (!other) throw new Error("system widget needs two sizes");
    widgetMenuItems(t, app.layout).find((i) => i.id === `size-${other.id}`)?.run();
    expect(app.layout.getState().editing).toBe(true);
    expect(app.layout.getState().placements.find((p) => p.id === "system-1")?.size).toBe(other.id);
    app.layout.getState().undo();
    expect(app.layout.getState().placements.find((p) => p.id === "system-1")?.size).toBe(t.size);
  });

  it("duplicates and opens the gallery aimed at the pointed cell", async () => {
    const app = await boot();
    const before = app.layout.getState().placements.length;
    const items = widgetMenuItems(target(app, "system-1"), app.layout);
    items.find((i) => i.id === "duplicate")?.run();
    expect(app.layout.getState().placements.length).toBe(before + 1);
    items.find((i) => i.id === "add")?.run();
    expect(editUi.getState()).toMatchObject({ drawerOpen: true, drawerTab: "add", addAt: { x: 1, y: 7 } });
  });

  it("disables every edit while the layout is locked, but still opens edit mode", async () => {
    const app = await boot();
    const items = widgetMenuItems(target(app, "system-1", true), app.layout);
    expect(items.filter((i) => !i.disabled).map((i) => i.id)).toEqual(["edit"]);
  });
});

describe("removing a widget", () => {
  it("drops it as one undoable step and offers undo in a toast", async () => {
    const app = await boot();
    app.layout.getState().enterEdit();
    expect(await removeWithExit(app.layout, "system-1", "System", noDom())).toBe(true);
    expect(app.layout.getState().placements.some((p) => p.id === "system-1")).toBe(false);
    expect(editUi.getState().undoToast?.message).toBe("System removed");
    app.layout.getState().undo();
    expect(app.layout.getState().placements.some((p) => p.id === "system-1")).toBe(true);
  });

  it("refuses while locked or outside edit mode, and animates nothing", async () => {
    const app = await boot();
    const exit = vi.fn(async () => undefined);
    expect(await removeWithExit(app.layout, "system-1", "System", { ...noDom(), exit })).toBe(false);
    app.layout.getState().enterEdit();
    expect(await removeWithExit(app.layout, "system-1", "System", { ...noDom(true), exit })).toBe(false);
    expect(exit).not.toHaveBeenCalled();
    expect(app.layout.getState().placements.some((p) => p.id === "system-1")).toBe(true);
  });
});

describe("adding from the gallery", () => {
  it("centres the new widget on the pointed cell, or leaves it to the first free spot", () => {
    expect(addOrigin({ x: 5, y: 4 }, { w: 4, h: 2 })).toEqual({ x: 4, y: 4 });
    expect(addOrigin(null, { w: 4, h: 2 })).toBeUndefined();
  });
});

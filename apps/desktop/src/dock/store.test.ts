import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Category, CategoryId, DockApp } from "./protocol";

// The store reads the page address and local storage when it is created; the tests have neither.
vi.stubGlobal("location", { search: "" });
const { isFrozen, useDockStore } = await import("./store");

const NOW = Date.now();
const category = (id: CategoryId): Category => ({ id, name: null, tone: "neutral", order: 0 });
const app = (id: string, cat: CategoryId, firstSeen: number): DockApp => ({ id, name: id, category: cat, filedBy: "known", icon: "", publisher: null, firstSeen });
const FROM = { x: 0, y: 0, w: 10, h: 10 };

describe("showStack", () => {
  beforeAll(() => {
    expect(useDockStore.getState().stack).toBeNull();
  });

  beforeEach(() => {
    useDockStore.setState({
      categories: [category("media"), category("utilities")],
      apps: [app("new", "media", NOW - 1000), app("old", "media", NOW - 30 * 24 * 3_600_000), app("other", "utilities", NOW - 1000)],
      seen: new Set(),
      stack: null,
    });
  });

  it("opens the category with the apps that were new at that moment", () => {
    useDockStore.getState().showStack("media", FROM);
    const { stack } = useDockStore.getState();
    expect(stack?.category).toBe("media");
    expect([...(stack?.fresh ?? [])]).toEqual(["new"]);
  });

  it("marks them seen only after noting them, so the popover can still badge them", () => {
    useDockStore.getState().showStack("media", FROM);
    const { seen, stack } = useDockStore.getState();
    expect(seen.has("new")).toBe(true);
    expect(stack?.fresh.has("new")).toBe(true);
  });

  it("leaves the apps of other stacks unseen", () => {
    useDockStore.getState().showStack("media", FROM);
    expect(useDockStore.getState().seen.has("other")).toBe(false);
  });

  it("badges nothing the second time", () => {
    useDockStore.getState().showStack("media", FROM);
    useDockStore.getState().showStack("media", FROM);
    expect(useDockStore.getState().stack?.fresh.size).toBe(0);
  });
});

describe("isFrozen", () => {
  const calm = { locked: false, displayOff: false, fullscreen: false, frozen: false };

  it("is false while nothing asks the dock to stop", () => {
    expect(isFrozen(calm)).toBe(false);
  });

  it.each(["locked", "displayOff", "fullscreen"] as const)("is true when the core says %s", (reason) => {
    expect(isFrozen({ ...calm, [reason]: true, frozen: true })).toBe(true);
  });
});

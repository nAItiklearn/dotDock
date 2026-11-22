import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CENTRED } from "./frame";
import { createPhotoStore, EMPTY_ENTRY } from "./store";

const KEY = "dotdock.widgets.photos";

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

/**
 * A fresh store reading from the given storage, as a window starting up would. Built from the factory, not
 * by reloading the module: a reload per case re-evaluated the whole import graph and, on a busy machine,
 * ran past the test timeout.
 */
async function openStore(initial: Record<string, string> = {}) {
  const storage = fakeStorage(initial);
  vi.stubGlobal("localStorage", storage);
  return { usePhotoStore: createPhotoStore(), EMPTY_ENTRY, storage };
}

const saved = (storage: Storage): { state: { entries: Record<string, unknown> }; version: number } =>
  JSON.parse(storage.getItem(KEY) ?? "null") as { state: { entries: Record<string, unknown> }; version: number };

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("photo store persistence", () => {
  it("starts empty and gives a widget with no entry the centred, unzoomed default", async () => {
    const { usePhotoStore, EMPTY_ENTRY } = await openStore();
    expect(usePhotoStore.getState().entries).toEqual({});
    expect(EMPTY_ENTRY).toEqual({ framing: CENTRED, rev: 0 });
  });

  it("saves a framing per placement id and restores it in the next window", async () => {
    const first = await openStore();
    first.usePhotoStore.getState().frame("photo-1", { x: 0.2, y: 0.7, zoom: 2 });
    first.usePhotoStore.getState().frame("photo-2", { x: 0.9, y: 0.1, zoom: 1.5 });
    const raw = first.storage.getItem(KEY) ?? "";
    expect(saved(first.storage).version).toBe(1);

    const second = await openStore({ [KEY]: raw });
    expect(second.usePhotoStore.getState().entries["photo-1"]?.framing).toEqual({ x: 0.2, y: 0.7, zoom: 2 });
    expect(second.usePhotoStore.getState().entries["photo-2"]?.framing).toEqual({ x: 0.9, y: 0.1, zoom: 1.5 });
  });

  it("clamps a framing on the way in and recentres a replaced photo", async () => {
    const { usePhotoStore } = await openStore();
    const store = usePhotoStore.getState();
    store.frame("photo-1", { x: 4, y: -2, zoom: 40 });
    expect(usePhotoStore.getState().entries["photo-1"]).toEqual({ framing: { x: 1, y: 0, zoom: 4 }, rev: 0 });
    store.replaced("photo-1");
    expect(usePhotoStore.getState().entries["photo-1"]).toEqual({ framing: CENTRED, rev: 1 });
  });

  it("repairs what it reads back: damaged numbers, missing parts and entries that are not objects", async () => {
    const stored = {
      state: {
        entries: {
          fine: { framing: { x: 0.25, y: 0.75, zoom: 2 }, rev: 3 },
          loud: { framing: { x: 9, y: -9, zoom: 99 }, rev: 2 },
          broken: { framing: { x: "left", y: null, zoom: Number.NaN }, rev: -1 },
          bare: { rev: 1.5 },
          junk: 7,
        },
      },
      version: 1,
    };
    const { usePhotoStore } = await openStore({ [KEY]: JSON.stringify(stored) });
    const entries = usePhotoStore.getState().entries;
    expect(entries["fine"]).toEqual({ framing: { x: 0.25, y: 0.75, zoom: 2 }, rev: 3 });
    expect(entries["loud"]).toEqual({ framing: { x: 1, y: 0, zoom: 4 }, rev: 2 });
    expect(entries["broken"]).toEqual({ framing: CENTRED, rev: 0 });
    expect(entries["bare"]).toEqual({ framing: CENTRED, rev: 0 });
    expect(entries).not.toHaveProperty("junk");
  });

  it("starts empty when the saved value is not valid JSON", async () => {
    const { usePhotoStore } = await openStore({ [KEY]: "{not json" });
    expect(usePhotoStore.getState().entries).toEqual({});
  });
});

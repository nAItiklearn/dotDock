import { describe, expect, it } from "vitest";
import { layoutCodec, settingsCodec } from "../model/codecs";
import { DEFAULT_SETTINGS, defaultLayoutDoc } from "../model/defaults";
import type { AppSettings, LayoutDoc } from "../model/types";
import { LocalStorageBackend, MemoryBackend, type StorageBackend, type StorageLike } from "./backend";
import { DocumentStore } from "./documentStore";
import type { Notice } from "./notice";

function setup(backend: StorageBackend = new MemoryBackend()) {
  const notices: Notice[] = [];
  const store = new DocumentStore<AppSettings>(backend, "settings", settingsCodec, "your settings", (n) => notices.push(n));
  return { backend, store, notices };
}

const withTheme = (id: string): AppSettings => ({ ...DEFAULT_SETTINGS, theme: { ...DEFAULT_SETTINGS.theme, fixedId: id } });

describe("DocumentStore: loading", () => {
  it("returns defaults silently on first run", async () => {
    const { store, notices } = setup();
    expect(await store.load()).toEqual({ value: DEFAULT_SETTINGS, source: "missing" });
    expect(notices).toEqual([]);
  });

  it("round-trips a saved document", async () => {
    const { store, backend } = setup();
    await store.load();
    await store.save(withTheme("paper"));
    const reopened = new DocumentStore(backend, "settings", settingsCodec, "your settings", () => undefined);
    const loaded = await reopened.load();
    expect(loaded.source).toBe("primary");
    expect(loaded.value.theme.fixedId).toBe("paper");
  });

  it("falls back to the last good copy when the document is corrupt, and says so", async () => {
    const { store, backend, notices } = setup();
    await store.load();
    await store.save(withTheme("paper"));
    await store.save(withTheme("aurum"));
    await backend.write("settings", "{ this is not json");

    const reopened = setup(backend);
    const loaded = await reopened.store.load();
    expect(loaded.source).toBe("backup");
    expect(loaded.value.theme.fixedId).toBe("paper");
    expect(reopened.notices).toHaveLength(1);
    expect(reopened.notices[0]).toMatchObject({ level: "warning", message: "Couldn't read your settings. Restored the last good copy." });
    expect(notices).toEqual([]);
    expect(await backend.read("settings.corrupt")).toBe("{ this is not json");
    // The primary was rewritten from the backup, so the next launch is clean.
    expect(JSON.parse((await backend.read("settings")) ?? "{}").theme.fixedId).toBe("paper");
  });

  it("starts from defaults, keeping the damaged text, when there is no backup either", async () => {
    const backend = new MemoryBackend();
    await backend.write("settings", "\u0000garbage");
    const { store, notices } = setup(backend);
    const loaded = await store.load();
    expect(loaded.source).toBe("defaults");
    expect(loaded.value).toEqual(DEFAULT_SETTINGS);
    expect(notices[0]?.message).toBe("Couldn't read your settings. Started from defaults; the damaged copy is kept.");
    expect(await backend.read("settings.corrupt")).toBe("\u0000garbage");
  });

  it("treats a document that parses but is not an object as damaged", async () => {
    const backend = new MemoryBackend();
    await backend.write("settings", "[1,2,3]");
    const { store } = setup(backend);
    expect((await store.load()).source).toBe("defaults");
  });

  it("does not downgrade a document from a newer app; it keeps it aside", async () => {
    const backend = new MemoryBackend();
    const future = JSON.stringify({ schema: 99, theme: { fixedId: "paper" } });
    await backend.write("settings", future);
    const { store, notices } = setup(backend);
    const loaded = await store.load();
    expect(loaded.source).toBe("defaults");
    expect(notices[0]?.message).toContain("newer version");
    expect(await backend.read("settings.future")).toBe(future);
    expect(await backend.read("settings.corrupt")).toBeNull();
  });

  it("repairs a document with a bad entry in place and mentions it once", async () => {
    const backend = new MemoryBackend();
    await backend.write("settings", JSON.stringify({ schema: 1, profiles: [{ id: "bad id" }], layout: { gap: 14 } }));
    const { store, notices } = setup(backend);
    const loaded = await store.load();
    expect(loaded.source).toBe("primary");
    expect(loaded.value.layout.gap).toBe(14);
    expect(loaded.value.profiles.map((p) => p.id)).toEqual(["work", "focus", "minimal"]);
    expect(notices).toEqual([
      { key: "repair:settings", level: "info", message: "Some values in your settings were out of range and were corrected." },
    ]);
  });

  it("fills in missing fields from defaults without any notice", async () => {
    const backend = new MemoryBackend();
    await backend.write("settings", JSON.stringify({ schema: 1, layout: { gap: 14 } }));
    const { store, notices } = setup(backend);
    expect((await store.load()).value.layout).toMatchObject({ gap: 14, collision: "push" });
    expect(notices).toEqual([]);
  });

  it("recovers from the backup when the primary has vanished", async () => {
    const { store, backend } = setup();
    await store.load();
    await store.save(withTheme("paper"));
    await store.save(withTheme("aurum"));
    await backend.remove("settings");
    const reopened = setup(backend);
    const loaded = await reopened.store.load();
    expect(loaded.source).toBe("backup");
    expect(loaded.value.theme.fixedId).toBe("paper");
  });

  it("never throws when the backend itself fails", async () => {
    const broken: StorageBackend = {
      read: () => Promise.reject(new Error("disk on fire")),
      write: () => Promise.reject(new Error("disk on fire")),
      remove: () => Promise.reject(new Error("disk on fire")),
      list: () => Promise.reject(new Error("disk on fire")),
      watch: () => () => undefined,
    };
    const { store, notices } = setup(broken);
    expect((await store.load()).source).toBe("defaults");
    expect(notices[0]?.level).toBe("error");
  });
});

describe("DocumentStore: saving", () => {
  it("keeps the previous good text as the backup on every save", async () => {
    const { store, backend } = setup();
    await store.load();
    await store.save(withTheme("paper"));
    expect(await backend.read("settings.bak")).toBeNull();
    await store.save(withTheme("aurum"));
    expect(JSON.parse((await backend.read("settings.bak")) ?? "{}").theme.fixedId).toBe("paper");
    expect(JSON.parse((await backend.read("settings")) ?? "{}").theme.fixedId).toBe("aurum");
  });

  it("skips the write when nothing changed", async () => {
    const { store, backend } = setup();
    await store.load();
    await store.save(withTheme("paper"));
    await store.save(withTheme("paper"));
    expect(await backend.read("settings.bak")).toBeNull();
  });

  it("coalesces rapid saves: only the latest value is written, every caller still resolves", async () => {
    const writes: string[] = [];
    const backend = new MemoryBackend();
    const original = backend.write.bind(backend);
    backend.write = async (name, text) => {
      writes.push(name);
      await Promise.resolve();
      return original(name, text);
    };
    const { store } = setup(backend);
    await store.load();
    const results = await Promise.all(["paper", "aurum", "obsidian", "paper"].map((id) => store.save(withTheme(id))));
    expect(results).toHaveLength(4);
    expect(JSON.parse((await backend.read("settings")) ?? "{}").theme.fixedId).toBe("paper");
    // First save writes the primary; the queued ones collapse into a single further write.
    expect(writes.filter((n) => n === "settings").length).toBeLessThanOrEqual(2);
  });

  it("rejects the save and shows an error notice when storage is full, without losing earlier data", async () => {
    const backend = new MemoryBackend();
    const { store, notices } = setup(backend);
    await store.load();
    await store.save(withTheme("paper"));
    const original = backend.write.bind(backend);
    backend.write = () => Promise.reject(new Error("QuotaExceededError"));
    await expect(store.save(withTheme("aurum"))).rejects.toThrow();
    expect(notices.at(-1)).toMatchObject({ level: "error", key: "write:settings" });
    backend.write = original;
    expect(JSON.parse((await backend.read("settings")) ?? "{}").theme.fixedId).toBe("paper");
  });

  it("writes the migrated document and keeps the old text as a safety copy", async () => {
    const backend = new MemoryBackend();
    const v1 = JSON.stringify({ schema: 1, placements: [{ id: "clock-1", kind: "clock", x: 0, y: 0, config: { height: 128 } }] });
    await backend.write("layouts/work", v1);
    const notices: Notice[] = [];
    const store = new DocumentStore<LayoutDoc>(backend, "layouts/work", layoutCodec("work"), "the Work layout", (n) => notices.push(n));
    const loaded = await store.load();
    expect(loaded.source).toBe("primary");
    expect(loaded.value.monitors["primary"]?.placements[0]).toMatchObject({ id: "clock-1", size: "m" });
    expect(await backend.read("layouts/work.v1")).toBe(v1);
    await store.save(loaded.value);
    expect(JSON.parse((await backend.read("layouts/work")) ?? "{}").schema).toBe(2);
    expect(notices).toEqual([]);
  });

  it("removes a document and its backup", async () => {
    const { store, backend } = setup();
    await store.load();
    await store.save(withTheme("paper"));
    await store.save(withTheme("aurum"));
    await store.remove();
    expect(await backend.read("settings")).toBeNull();
    expect(await backend.read("settings.bak")).toBeNull();
  });
});

describe("layout documents fall back to the profile's own defaults", () => {
  it("restores the built-in layout when a built-in profile's file is destroyed", async () => {
    const backend = new MemoryBackend();
    await backend.write("layouts/focus", "oops");
    const store = new DocumentStore<LayoutDoc>(backend, "layouts/focus", layoutCodec("focus"), "the Focus layout", () => undefined);
    expect((await store.load()).value).toEqual(defaultLayoutDoc("focus"));
  });
});

describe("backends", () => {
  function fakeStorage(): StorageLike & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      get length() {
        return data.size;
      },
      key: (i) => [...data.keys()][i] ?? null,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  }

  it("localStorage backend namespaces keys and lists documents without bookkeeping copies", async () => {
    const storage = fakeStorage();
    storage.setItem("someone-elses-key", "1");
    const backend = new LocalStorageBackend(storage);
    await backend.write("layouts/work", "a");
    await backend.write("layouts/work.bak", "b");
    await backend.write("layouts/work.v1", "c");
    await backend.write("layouts/focus", "d");
    await backend.write("themes/custom-x", "e");
    expect(await backend.list("layouts/")).toEqual(["layouts/focus", "layouts/work"]);
    expect(await backend.read("layouts/work")).toBe("a");
    expect(storage.data.has("dotdock/layouts/work")).toBe(true);
    await backend.remove("layouts/work");
    expect(await backend.read("layouts/work")).toBeNull();
  });

  it("localStorage backend reports a failed write as a rejection", async () => {
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    await expect(new LocalStorageBackend(storage).write("a", "b")).rejects.toThrow("QuotaExceededError");
  });

  it("forwards storage events from other windows for our keys only", () => {
    const listeners = new Set<(e: Event) => void>();
    const target = {
      addEventListener: (_: string, l: EventListenerOrEventListenerObject) => void listeners.add(l as (e: Event) => void),
      removeEventListener: (_: string, l: EventListenerOrEventListenerObject) => void listeners.delete(l as (e: Event) => void),
    } as unknown as Pick<Window, "addEventListener" | "removeEventListener">;
    const backend = new LocalStorageBackend(fakeStorage(), target);
    const seen: string[] = [];
    const stop = backend.watch((n) => seen.push(n));
    for (const l of listeners) {
      l({ key: "dotdock/settings" } as unknown as Event);
      l({ key: "unrelated" } as unknown as Event);
    }
    stop();
    expect(seen).toEqual(["settings"]);
    expect(listeners.size).toBe(0);
  });
});

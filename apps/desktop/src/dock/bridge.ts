import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../providers/bridge";
import type { Rect } from "./geometry";
import { activationTarget } from "./model";
import type { Category, CategoryId, CommandResult, DockApp, DockBackdrop, DockSettings, DockSnapshot, DockWindow, FrozenState } from "./protocol";
import { isFrozen, useDockStore } from "./store";
import { t } from "./strings";

/** Everything the dock needs from the outside world. The Tauri core provides it; a browser has nothing. */
export interface DockBackend {
  ready: () => Promise<DockSnapshot | null>;
  /** Subscribes to pushed updates and returns the unsubscribe function. */
  subscribe: (handlers: Handlers) => Promise<() => void>;
  launch: (appId: string) => Promise<CommandResult>;
  activate: (hwnd: string) => Promise<CommandResult>;
  closeWindow: (hwnd: string) => Promise<CommandResult>;
  setCategory: (appId: string, category: CategoryId) => Promise<CommandResult>;
  saveCategories: (categories: readonly Category[]) => Promise<CommandResult>;
  setSettings: (settings: DockSettings) => Promise<CommandResult>;
  setRegions: (rects: readonly Rect[]) => void;
  preview: (args: { hwnds: readonly string[]; anchor: Rect } | { hwnds: [] }) => void;
  setFocus: (active: boolean) => void;
}

export interface Handlers {
  readonly apps: (apps: readonly DockApp[]) => void;
  readonly windows: (windows: readonly DockWindow[]) => void;
  readonly settings: (settings: DockSettings) => void;
  readonly library: (action: "toggle" | "open" | "close") => void;
  readonly pointer: (inside: boolean) => void;
  readonly frozen: (state: FrozenState) => void;
  readonly backdrop: (backdrop: DockBackdrop) => void;
}

/** A rejected invoke becomes a failed result: every command resolves, as the contract promises. */
async function command(name: string, args?: Record<string, unknown>): Promise<CommandResult> {
  try {
    return await invoke<CommandResult>(name, args);
  } catch (err) {
    console.error(`${name} failed`, err);
    return { ok: false, reason: String(err) };
  }
}

/** Fire-and-forget commands: a failure is visible in devtools but never breaks the UI. */
function fireAndForget(name: string, args?: Record<string, unknown>): void {
  invoke(name, args).catch((err: unknown) => console.error(`${name} failed`, err));
}

const tauriBackend: DockBackend = {
  ready: () => invoke<DockSnapshot>("dock_ready"),
  subscribe: async (handlers) => {
    const offs = await Promise.all([
      listen<readonly DockApp[]>("dock://apps", (e) => handlers.apps(e.payload)),
      listen<readonly DockWindow[]>("dock://windows", (e) => handlers.windows(e.payload)),
      listen<DockSettings>("dock://settings", (e) => handlers.settings(e.payload)),
      listen<"toggle" | "open" | "close">("dock://library", (e) => handlers.library(e.payload)),
      listen<{ inside: boolean }>("dock://pointer", (e) => handlers.pointer(e.payload.inside)),
      listen<FrozenState>("dock://frozen", (e) => handlers.frozen(e.payload)),
      listen<DockBackdrop>("dock://backdrop", (e) => handlers.backdrop(e.payload)),
    ]);
    return () => offs.forEach((off) => off());
  },
  launch: (appId) => command("dock_launch", { appId }),
  activate: (hwnd) => command("dock_activate", { hwnd }),
  closeWindow: (hwnd) => command("dock_close_window", { hwnd }),
  setCategory: (appId, category) => command("dock_set_category", { appId, category }),
  saveCategories: (categories) => command("dock_save_categories", { categories }),
  setSettings: (settings) => command("dock_set_settings", { settings }),
  setRegions: (rects) => fireAndForget("dock_set_regions", { rects }),
  preview: (args) => fireAndForget("dock_preview", args),
  setFocus: (active) => fireAndForget("dock_set_focus", { active }),
};

/** A plain browser outside `vite dev` has no core to talk to: the dock stays empty. */
const detachedBackend: DockBackend = {
  ready: () => Promise.resolve(null),
  subscribe: () => Promise.resolve(() => undefined),
  launch: () => Promise.resolve({ ok: false, reason: "no core" }),
  activate: () => Promise.resolve({ ok: false, reason: "no core" }),
  closeWindow: () => Promise.resolve({ ok: false, reason: "no core" }),
  setCategory: () => Promise.resolve({ ok: false, reason: "no core" }),
  saveCategories: () => Promise.resolve({ ok: false, reason: "no core" }),
  setSettings: () => Promise.resolve({ ok: false, reason: "no core" }),
  setRegions: () => undefined,
  preview: () => undefined,
  setFocus: () => undefined,
};

let backend: DockBackend = isTauri() ? tauriBackend : detachedBackend;

/** Lets the dev-only fixture stand in for the core. Never called in production code paths. */
export function setBackend(next: DockBackend): void {
  backend = next;
}

let connected: Promise<() => void> | null = null;

/** Loads the first snapshot and starts listening for pushes. The first call does the work, later calls share it. */
export function connectDock(): Promise<() => void> {
  connected ??= start();
  return connected;
}

async function start(): Promise<() => void> {
  const store = useDockStore.getState();
  const off = await backend.subscribe({
    apps: store.applyApps,
    windows: store.applyWindows,
    settings: store.applySettings,
    library: (action) => {
      const { libraryOpen, setLibrary } = useDockStore.getState();
      setLibrary(action === "toggle" ? !libraryOpen : action === "open");
    },
    pointer: store.setPointerInside,
    frozen: (state) => store.setFrozen(isFrozen(state)),
    backdrop: store.setBackdrop,
  });
  const snapshot = await backend.ready();
  if (snapshot) store.applySnapshot(snapshot);
  return off;
}

const fail = (text: string): void => useDockStore.getState().setNotice(text);

export const actions = {
  setRegions: (rects: readonly Rect[]): void => backend.setRegions(rects),
  preview: (args: Parameters<DockBackend["preview"]>[0]): void => backend.preview(args),
  setFocus: (active: boolean): void => backend.setFocus(active),

  /** Opens an app. A failure shows a notice naming the app. */
  async launch(appId: string, name: string): Promise<void> {
    useDockStore.getState().markSeen([appId]);
    const result = await backend.launch(appId);
    if (!result.ok) fail(t("launch.failed", { name }));
  },

  /** Brings an app forward if it has windows, else starts it. Used by the stack popover and the App Library. */
  async open(app: { readonly id: string; readonly name: string }): Promise<void> {
    const windows = useDockStore.getState().windows.filter((w) => w.appId === app.id);
    const target = activationTarget(windows);
    if (target) await actions.activate(target.hwnd, app.name);
    else await actions.launch(app.id, app.name);
  },

  async activate(hwnd: string, name: string): Promise<void> {
    const result = await backend.activate(hwnd);
    if (!result.ok) fail(t("activate.failed", { name }));
  },

  async closeWindows(hwnds: readonly string[]): Promise<void> {
    await Promise.all(hwnds.map((hwnd) => backend.closeWindow(hwnd)));
  },

  /** Files an app in a category. Shown at once; put back if the core refuses. */
  async setCategory(appId: string, category: CategoryId): Promise<void> {
    const store = useDockStore.getState();
    const before = store.apps;
    store.setApps(before.map((a) => (a.id === appId ? { ...a, category, filedBy: "user" } : a)));
    const result = await backend.setCategory(appId, category);
    if (!result.ok) {
      useDockStore.getState().setApps(before);
      fail(t("setting.failed"));
    }
  },

  /** Applies a settings change at once and hands it to the core, which validates, stores and echoes it back. */
  async updateSettings(patch: Partial<DockSettings>): Promise<void> {
    const store = useDockStore.getState();
    const before = store.settings;
    const next: DockSettings = { ...before, ...patch };
    store.applySettings(next);
    const result = await backend.setSettings(next);
    if (!result.ok) {
      useDockStore.getState().applySettings(before);
      fail(t("setting.failed"));
    }
  },
};

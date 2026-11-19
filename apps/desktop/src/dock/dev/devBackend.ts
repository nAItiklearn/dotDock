import type { DockBackend, Handlers } from "../bridge";
import type { Rect } from "../geometry";
import type { Category, CategoryId, CommandResult, DockApp, DockSettings, DockSnapshot, DockWindow } from "../protocol";
import { APPS, CATEGORIES, SAMPLE_NOW, SETTINGS, WINDOWS, makeApp } from "./fixtures";

/** DEV ONLY. Stands in for the Tauri core so the dock can be designed in a plain browser. */

const LAUNCH_DELAY_MS = 450;
const ok: CommandResult = { ok: true };

interface Model {
  categories: readonly Category[];
  apps: readonly DockApp[];
  windows: readonly DockWindow[];
  settings: DockSettings;
}

let model: Model = { categories: CATEGORIES, apps: APPS, windows: WINDOWS, settings: SETTINGS };
let handlers: Handlers | null = null;
let nextHwnd = 5000;
let regions: readonly Rect[] = [];
let previewRequest: Parameters<DockBackend["preview"]>[0] = { hwnds: [] };
let focusActive = false;
let failNext: string | null = null;

const log: string[] = [];
const note = (line: string): void => {
  log.push(line);
  if (log.length > 40) log.shift();
};

const pushWindows = (windows: readonly DockWindow[]): void => {
  model = { ...model, windows };
  handlers?.windows(windows);
};

export const dev = {
  snapshot: (): DockSnapshot => model,
  /** Makes the next command fail with this reason, to design the error states. */
  failNext: (reason: string | null): void => {
    failNext = reason;
  },
  regions: (): readonly Rect[] => regions,
  preview: (): Parameters<DockBackend["preview"]>[0] => previewRequest,
  focusActive: (): boolean => focusActive,
  log: (): readonly string[] => log,
  setWindows: pushWindows,
  setSettings(settings: DockSettings): void {
    model = { ...model, settings };
    handlers?.settings(settings);
  },
  patchSettings(patch: Partial<DockSettings>): void {
    dev.setSettings({ ...model.settings, ...patch });
  },
  /** An app that was just installed: filed automatically and badged as new. */
  install(name: string, category: CategoryId): void {
    const app = makeApp(name, category, model.apps.length, SAMPLE_NOW - 60_000);
    model = { ...model, apps: [...model.apps, app] };
    handlers?.apps(model.apps);
  },
  library(action: "toggle" | "open" | "close"): void {
    handlers?.library(action);
  },
  freeze(frozen: boolean): void {
    handlers?.frozen(frozen);
  },
  pointer(inside: boolean): void {
    handlers?.pointer(inside);
  },
};

function refuse(): CommandResult | null {
  if (failNext === null) return null;
  const reason = failNext;
  failNext = null;
  return { ok: false, reason };
}

export const devBackend: DockBackend = {
  ready: () => Promise.resolve(model),
  subscribe: (next) => {
    handlers = next;
    return Promise.resolve(() => {
      handlers = null;
    });
  },
  launch: (appId) => {
    const refused = refuse();
    if (refused) return Promise.resolve(refused);
    note(`launch ${appId}`);
    const app = model.apps.find((a) => a.id === appId);
    if (app) {
      setTimeout(() => {
        pushWindows([
          ...model.windows,
          { hwnd: String(nextHwnd++), appId, title: app.name, icon: app.icon, minimized: false, focused: true, flashing: false },
        ]);
      }, LAUNCH_DELAY_MS);
    }
    return Promise.resolve(ok);
  },
  activate: (hwnd) => {
    const refused = refuse();
    if (refused) return Promise.resolve(refused);
    note(`activate ${hwnd}`);
    const target = model.windows.find((w) => w.hwnd === hwnd);
    const toggleOff = target?.focused === true;
    pushWindows(model.windows.map((w) => ({ ...w, focused: w.hwnd === hwnd && !toggleOff, minimized: w.hwnd === hwnd ? toggleOff : w.minimized })));
    return Promise.resolve(ok);
  },
  closeWindow: (hwnd) => {
    note(`close ${hwnd}`);
    pushWindows(model.windows.filter((w) => w.hwnd !== hwnd));
    return Promise.resolve(ok);
  },
  setCategory: (appId, category) => {
    const refused = refuse();
    if (refused) return Promise.resolve(refused);
    note(`category ${appId} -> ${category}`);
    model = { ...model, apps: model.apps.map((a) => (a.id === appId ? { ...a, category, filedBy: "user" } : a)) };
    handlers?.apps(model.apps);
    return Promise.resolve(ok);
  },
  saveCategories: (categories) => {
    model = { ...model, categories };
    return Promise.resolve(ok);
  },
  setSettings: (settings) => {
    const refused = refuse();
    if (refused) return Promise.resolve(refused);
    note("settings saved");
    model = { ...model, settings };
    handlers?.settings(settings);
    return Promise.resolve(ok);
  },
  setRegions: (next) => {
    regions = next;
  },
  preview: (args) => {
    previewRequest = args;
  },
  setFocus: (active) => {
    focusActive = active;
  },
};


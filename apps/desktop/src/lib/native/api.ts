import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../providers/bridge";
import type { ShortcutAction } from "../model/types";
import type { DockSettings } from "./dock";

/**
 * The typed surface between the UI and the Rust core. Every method maps to one Tauri command
 * (named in the comment above it); arguments are passed as a single object under the names shown.
 * Anything the core cannot do yet rejects, and the page shows a designed error state for it.
 * In a plain browser there is no core: `available` is false and every call rejects with
 * NativeUnavailableError, which pages turn into the "available in the desktop app" state.
 */

export class NativeUnavailableError extends Error {
  constructor() {
    super("This needs the desktop app.");
    this.name = "NativeUnavailableError";
  }
}

// ---------------------------------------------------------------- types

export interface BootStage {
  readonly name: string;
  readonly ms: number;
}

export interface StartupState {
  /** False means the stock Windows desktop is in charge and the overlay is closed. */
  readonly useOurDesktop: boolean;
  readonly launchAtSignIn: boolean;
  readonly hideDesktopIcons: boolean;
  /** Informational: the Windows startup delay has been removed for this user. */
  readonly startupDelayRemoved: boolean;
  /** Stage timings of the last start. `startedAt` is Unix ms; each stage's `ms` counts from process launch. */
  readonly lastBoot: { readonly startedAt: number; readonly stages: readonly BootStage[] } | null;
}

export type StartupToggle = "useOurDesktop" | "launchAtSignIn" | "hideDesktopIcons";

export interface RestoreReport {
  readonly wallpaperRestored: boolean;
  readonly desktopIconsShown: boolean;
  readonly autostartRemoved: boolean;
  readonly startupDelayRestored: boolean;
}

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DisplayInfo {
  /** Stable id, the same value the overlay window receives as its `monitor` URL parameter. */
  readonly id: string;
  readonly name: string;
  readonly primary: boolean;
  readonly bounds: PixelRect;
  /** The area not covered by the native taskbar. */
  readonly workArea: PixelRect;
  /** 1 = 100 %, 1.25 = 125 %. */
  readonly scaleFactor: number;
  readonly refreshHz: number | null;
}

export type WallpaperFit = "fill" | "fit" | "stretch" | "tile" | "center" | "span";

export interface WallpaperItem {
  /** Unique: `<name>-dark` / `<name>-light` for the bundled set, `imported-<n>` for your own pictures. */
  readonly id: string;
  readonly name: string;
  readonly source: "bundled" | "imported";
  /** Which variant a bundled wallpaper is; null for your own pictures. */
  readonly mode: "dark" | "light" | null;
  /** The wallpaper's accent colour (bundled only). */
  readonly accent: string | null;
  /** A URL the webview can load: a bundled thumbnail, or your picture through the core's wallpaper scheme. */
  readonly thumbnailUrl: string;
}

export interface WallpaperAssignment {
  readonly monitorId: string;
  /** Null means the user's original wallpaper, as snapshotted at onboarding. */
  readonly wallpaperId: string | null;
  readonly fit: WallpaperFit;
}

export type ShortcutStatus = "ok" | "conflict" | "invalid";

export interface AppInfo {
  readonly version: string;
  readonly build: string;
  readonly os: string;
  readonly webview: string;
  /** Folder holding settings, layouts and themes. */
  readonly dataDir: string;
}

export interface NativeApi {
  readonly available: boolean;

  startup: {
    /** `startup_get` () → StartupState */
    get(): Promise<StartupState>;
    /** `startup_set` { setting: StartupToggle, value: boolean } → StartupState */
    set(setting: StartupToggle, value: boolean): Promise<StartupState>;
    /** `restore_windows` () → RestoreReport. Runs the full panic routine. */
    restoreWindows(): Promise<RestoreReport>;
  };

  displays: {
    /** `displays_list` () → DisplayInfo[] */
    list(): Promise<readonly DisplayInfo[]>;
  };

  wallpapers: {
    /** `wallpapers_list` () → WallpaperItem[], the bundled set then your own pictures. */
    list(): Promise<readonly WallpaperItem[]>;
    /** `wallpapers_assignments` () → WallpaperAssignment[] */
    assignments(): Promise<readonly WallpaperAssignment[]>;
    /** `wallpapers_assign` { monitorId: string | "all", wallpaperId: string | null, fit: WallpaperFit } → WallpaperAssignment[] */
    assign(monitorId: string, wallpaperId: string | null, fit: WallpaperFit): Promise<readonly WallpaperAssignment[]>;
    /** `wallpapers_import` () → WallpaperItem | null. The core opens the file picker; null when cancelled. */
    importFile(): Promise<WallpaperItem | null>;
    /** `wallpapers_remove` { id: string } → void. Only imported wallpapers can be removed. */
    remove(id: string): Promise<void>;
  };

  shortcuts: {
    /**
     * `shortcuts_register` { bindings: Record<ShortcutAction, string> } → Record<ShortcutAction, ShortcutStatus>.
     * Replaces all global hotkeys. When one fires the core emits the `dotdock://command` event
     * ("edit-mode" toggle, "next-profile") or acts itself ("openSettings").
     */
    register(bindings: Readonly<Record<ShortcutAction, string>>): Promise<Readonly<Record<ShortcutAction, ShortcutStatus>>>;
  };

  window: {
    /** `settings_open` { page?: string } → void. Opens or focuses Settings, on a `#/<section>/<page>` route when given. */
    openSettings(page?: string): Promise<void>;
    /**
     * `overlay_edit_mode` { on: boolean } → void. The overlay reports entering or leaving edit mode so the
     * core can raise it above normal windows and give it keyboard focus, then restore it afterwards.
     */
    setEditMode(on: boolean): Promise<void>;
  };

  app: {
    /** `app_info` () → AppInfo */
    info(): Promise<AppInfo>;
    /** `app_open_data_folder` () → void */
    openDataFolder(): Promise<void>;
  };

  dock: {
    /** `settings_dock_get` () → DockSettings, from the dock's own store. */
    get(): Promise<DockSettings>;
    /** `settings_dock_set` { settings: DockSettings } → DockSettings. A running dock applies it at once. */
    set(settings: DockSettings): Promise<DockSettings>;
  };

}

// ------------------------------------------------------------- implementations

const unavailable = (): Promise<never> => Promise.reject(new NativeUnavailableError());

export const unavailableNativeApi: NativeApi = {
  available: false,
  startup: { get: unavailable, set: unavailable, restoreWindows: unavailable },
  displays: { list: unavailable },
  wallpapers: { list: unavailable, assignments: unavailable, assign: unavailable, importFile: unavailable, remove: unavailable },
  shortcuts: { register: unavailable },
  window: { openSettings: unavailable, setEditMode: unavailable },
  app: { info: unavailable, openDataFolder: unavailable },
  dock: { get: unavailable, set: unavailable },
};

const call = <T>(command: string, args?: Record<string, unknown>): Promise<T> => invoke<T>(command, args);

export const tauriNativeApi: NativeApi = {
  available: true,
  startup: {
    get: () => call("startup_get"),
    set: (setting, value) => call("startup_set", { setting, value }),
    restoreWindows: () => call("restore_windows"),
  },
  displays: { list: () => call("displays_list") },
  wallpapers: {
    list: () => call("wallpapers_list"),
    assignments: () => call("wallpapers_assignments"),
    assign: (monitorId, wallpaperId, fit) => call("wallpapers_assign", { monitorId, wallpaperId, fit }),
    importFile: () => call("wallpapers_import"),
    remove: (id) => call("wallpapers_remove", { id }),
  },
  shortcuts: { register: (bindings) => call("shortcuts_register", { bindings }) },
  window: {
    openSettings: (page) => call("settings_open", { page: page ?? null }),
    setEditMode: (on) => call("overlay_edit_mode", { on }),
  },
  app: { info: () => call("app_info"), openDataFolder: () => call("app_open_data_folder") },
  dock: {
    get: () => call("settings_dock_get"),
    set: (settings) => call("settings_dock_set", { settings }),
  },
};

let override: NativeApi | null = null;

/** Replaces the API for this page; used by the dev-only preview and by tests. */
export function setNativeApi(api: NativeApi | null): void {
  override = api;
}

export function getNativeApi(): NativeApi {
  if (override) return override;
  return isTauri() ? tauriNativeApi : unavailableNativeApi;
}

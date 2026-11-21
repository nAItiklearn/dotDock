import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../providers/bridge";
import type { ShortcutAction } from "../model/types";

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
  readonly launchAtSignIn: boolean;
  readonly hideDesktopIcons: boolean;
  /** Informational: the Windows startup delay has been removed for this user. */
  readonly startupDelayRemoved: boolean;
  /** Informational: this session was started in safe mode (Shift held, or after a crash loop). */
  readonly safeMode: boolean;
  /** Stage timings of the last start, from process launch to the overlay being shown. */
  readonly lastBoot: { readonly startedAt: string; readonly stages: readonly BootStage[] } | null;
}

export type StartupToggle = "launchAtSignIn" | "hideDesktopIcons";

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
  readonly id: string;
  readonly name: string;
  readonly source: "bundled" | "imported";
  /** A URL the webview can load (asset protocol or data URL). */
  readonly thumbnailUrl: string;
}

export interface WallpaperAssignment {
  readonly monitorId: string;
  /** Null means the user's original wallpaper, as snapshotted at onboarding. */
  readonly wallpaperId: string | null;
  readonly fit: WallpaperFit;
}

export interface PerformanceSettings {
  readonly pauseOnFullscreen: boolean;
  readonly pauseOnBatterySaver: boolean;
  readonly pauseWhenLocked: boolean;
  /** How often system providers (memory, disk, CPU) push, in Hz. */
  readonly systemRefreshHz: number;
}

export interface PerformanceStats {
  readonly overlayFps: number | null;
  readonly frameP95Ms: number | null;
  readonly cpuPercent: number;
  readonly workingSetMb: number;
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

export interface UpdateStatus {
  readonly enabled: boolean;
  readonly checkedAt: string | null;
  readonly available: { readonly version: string; readonly notes: string | null } | null;
}

/**
 * The dotDock environment, which runs as one unit: home screen, dock, taskbar replacement and notch.
 * The user has two choices over it, both applied at once and remembered.
 */
export interface EnvironmentState {
  /** The whole environment is switched on. Off is plain Windows. */
  readonly on: boolean;
  /** The Windows taskbar stays: by choice, or because this build has no replacement for it. */
  readonly windowsTaskbar: boolean;
  /** This build has a taskbar replacement the user can switch to. */
  readonly taskbarReplacement: boolean;
  /** Parts that are meant to run and did not start, each with its reason in words. */
  readonly problems: readonly string[];
}

export interface NativeApi {
  readonly available: boolean;

  environment: {
    /** `environment_get` () → EnvironmentState */
    get(): Promise<EnvironmentState>;
    /** `environment_set` { on } → EnvironmentState. Starts or stops everything now. */
    setOn(on: boolean): Promise<EnvironmentState>;
    /** `taskbar_set` { useWindows } → EnvironmentState. Rejects with the reason when the replacement cannot start. */
    setWindowsTaskbar(useWindows: boolean): Promise<EnvironmentState>;
    /** Hears the `environment://changed` event, which carries the full state. Resolves with the way to stop listening. */
    onChange(handler: (state: EnvironmentState) => void): Promise<() => void>;
  };

  startup: {
    /** `startup_get` () → StartupState */
    get(): Promise<StartupState>;
    /** `startup_set` { setting: StartupToggle, value: boolean } → StartupState */
    set(setting: StartupToggle, value: boolean): Promise<StartupState>;
  };

  displays: {
    /** `displays_list` () → DisplayInfo[] */
    list(): Promise<readonly DisplayInfo[]>;
  };

  wallpapers: {
    /** `wallpapers_list` () → [{ id, name, style, mode, accent, path, thumb }]; `thumb` becomes `thumbnailUrl`. */
    list(): Promise<readonly WallpaperItem[]>;
    /** `wallpapers_assignments` () → WallpaperAssignment[] */
    assignments(): Promise<readonly WallpaperAssignment[]>;
    /** `wallpapers_assign` { monitorId: string | "all", wallpaperId: string | null, fit: WallpaperFit } → WallpaperAssignment[] */
    assign(monitorId: string, wallpaperId: string | null, fit: WallpaperFit): Promise<readonly WallpaperAssignment[]>;
    /** `wallpapers_import` () → WallpaperItem | null. The core opens the file picker; null when cancelled. */
    importFile(): Promise<WallpaperItem | null>;
    /** `wallpapers_remove` { id: string } → void. Only imported wallpapers can be removed. */
    remove(id: string): Promise<void>;
    /** `wallpaper_current_image` () → raw file bytes. The picture Windows shows as the wallpaper; rejects for a solid colour. */
    currentImage(): Promise<Blob>;
  };

  performance: {
    /** `performance_get` () → PerformanceSettings */
    get(): Promise<PerformanceSettings>;
    /** `performance_set` { patch: Partial<PerformanceSettings> } → PerformanceSettings */
    set(patch: Partial<PerformanceSettings>): Promise<PerformanceSettings>;
    /** `performance_stats` () → PerformanceStats */
    stats(): Promise<PerformanceStats>;
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
    /** `settings_open` { page?: string } → void. Opens or focuses the Settings window on a page id. */
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

  updater: {
    /** `updater_status` () → UpdateStatus */
    status(): Promise<UpdateStatus>;
    /** `updater_set_enabled` { enabled: boolean } → UpdateStatus */
    setEnabled(enabled: boolean): Promise<UpdateStatus>;
    /** `updater_check` () → UpdateStatus */
    check(): Promise<UpdateStatus>;
  };
}

// ------------------------------------------------------------- implementations

const unavailable = (): Promise<never> => Promise.reject(new NativeUnavailableError());

export const unavailableNativeApi: NativeApi = {
  available: false,
  environment: { get: unavailable, setOn: unavailable, setWindowsTaskbar: unavailable, onChange: unavailable },
  startup: { get: unavailable, set: unavailable },
  displays: { list: unavailable },
  wallpapers: {
    list: unavailable,
    assignments: unavailable,
    assign: unavailable,
    importFile: unavailable,
    remove: unavailable,
    currentImage: unavailable,
  },
  performance: { get: unavailable, set: unavailable, stats: unavailable },
  shortcuts: { register: unavailable },
  window: { openSettings: unavailable, setEditMode: unavailable },
  app: { info: unavailable, openDataFolder: unavailable },
  updater: { status: unavailable, setEnabled: unavailable, check: unavailable },
};

const call = <T>(command: string, args?: Record<string, unknown>): Promise<T> => invoke<T>(command, args);

/** Shape of one `wallpapers_list` entry as the core returns it. */
interface CoreWallpaper {
  readonly id: string;
  readonly name: string;
  readonly style: string;
  readonly mode: string;
  readonly accent: string;
  readonly path: string;
  /** Web path such as `/wallpaper-thumbs/x.jpg`. */
  readonly thumb: string;
}

function toWallpaperItem(w: CoreWallpaper): WallpaperItem {
  return { id: w.id, name: w.name, source: "bundled", thumbnailUrl: w.thumb };
}

const ENVIRONMENT_CHANGED = "environment://changed";

export const tauriNativeApi: NativeApi = {
  available: true,
  environment: {
    get: () => call("environment_get"),
    setOn: (on) => call("environment_set", { on }),
    setWindowsTaskbar: (useWindows) => call("taskbar_set", { useWindows }),
    onChange: (handler) => listen<EnvironmentState>(ENVIRONMENT_CHANGED, (event) => handler(event.payload)),
  },
  startup: {
    get: () => call("startup_get"),
    set: (setting, value) => call("startup_set", { setting, value }),
  },
  displays: { list: () => call("displays_list") },
  wallpapers: {
    list: async () => (await call<readonly CoreWallpaper[]>("wallpapers_list")).map(toWallpaperItem),
    assignments: () => call("wallpapers_assignments"),
    assign: (monitorId, wallpaperId, fit) => call("wallpapers_assign", { monitorId, wallpaperId, fit }),
    importFile: () => call("wallpapers_import"),
    remove: (id) => call("wallpapers_remove", { id }),
    currentImage: async () => new Blob([await call<ArrayBuffer>("wallpaper_current_image")]),
  },
  performance: {
    get: () => call("performance_get"),
    set: (patch) => call("performance_set", { patch }),
    stats: () => call("performance_stats"),
  },
  shortcuts: { register: (bindings) => call("shortcuts_register", { bindings }) },
  window: {
    openSettings: (page) => call("settings_open", { page: page ?? null }),
    setEditMode: (on) => call("overlay_edit_mode", { on }),
  },
  app: { info: () => call("app_info"), openDataFolder: () => call("app_open_data_folder") },
  updater: {
    status: () => call("updater_status"),
    setEnabled: (enabled) => call("updater_set_enabled", { enabled }),
    check: () => call("updater_check"),
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

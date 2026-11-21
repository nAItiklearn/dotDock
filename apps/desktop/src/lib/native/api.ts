import { invoke } from "@tauri-apps/api/core";
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
  readonly useOurDesktop: boolean;
  readonly launchAtSignIn: boolean;
  readonly hideDesktopIcons: boolean;
  /** Informational: the Windows startup delay has been removed for this user. */
  readonly startupDelayRemoved: boolean;
  /** Informational: this session was started in safe mode (Shift held, or after a crash loop). */
  readonly safeMode: boolean;
  /** Stage timings of the last start, from process launch to the overlay being shown. */
  readonly lastBoot: { readonly startedAt: string; readonly stages: readonly BootStage[] } | null;
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
  /** Milliseconds since the Unix epoch of the last successful check. */
  readonly checkedAtMs: number | null;
  readonly available: { readonly version: string; readonly notes: string | null } | null;
  /** The last check could not reach the update service. */
  readonly failed: boolean;
}

export interface NativeApi {
  readonly available: boolean;

  startup: {
    /** `startup_get` () → StartupState */
    get(): Promise<StartupState>;
    /** `startup_set` { setting: StartupToggle, value: boolean } → StartupState */
    set(setting: StartupToggle, value: boolean): Promise<StartupState>;
    /** `restore_windows` () → void | RestoreReport. Runs the full panic routine; the core's reply shape is read tolerantly. */
    restoreWindows(): Promise<RestoreReport>;
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
    /** `updater_check` () → UpdateStatus */
    check(): Promise<UpdateStatus>;
    /** `updater_install` () → void. Downloads, verifies and runs the signed installer, which closes the app. */
    install(): Promise<void>;
  };
}

// ------------------------------------------------------------- implementations

const unavailable = (): Promise<never> => Promise.reject(new NativeUnavailableError());

export const unavailableNativeApi: NativeApi = {
  available: false,
  startup: { get: unavailable, set: unavailable, restoreWindows: unavailable },
  displays: { list: unavailable },
  wallpapers: { list: unavailable, assignments: unavailable, assign: unavailable, importFile: unavailable, remove: unavailable },
  performance: { get: unavailable, set: unavailable, stats: unavailable },
  shortcuts: { register: unavailable },
  window: { openSettings: unavailable, setEditMode: unavailable },
  app: { info: unavailable, openDataFolder: unavailable },
  updater: { status: unavailable, check: unavailable, install: unavailable },
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

/** `restore_windows` has no documented reply; whatever flags it returns are shown, and a bare success means every step ran. */
function toRestoreReport(raw: unknown): RestoreReport {
  const flag = (key: keyof RestoreReport): boolean => {
    const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)[key] : undefined;
    return typeof value === "boolean" ? value : true;
  };
  return {
    wallpaperRestored: flag("wallpaperRestored"),
    desktopIconsShown: flag("desktopIconsShown"),
    autostartRemoved: flag("autostartRemoved"),
    startupDelayRestored: flag("startupDelayRestored"),
  };
}

export const tauriNativeApi: NativeApi = {
  available: true,
  startup: {
    get: () => call("startup_get"),
    set: (setting, value) => call("startup_set", { setting, value }),
    restoreWindows: async () => toRestoreReport(await call<unknown>("restore_windows")),
  },
  displays: { list: () => call("displays_list") },
  wallpapers: {
    list: async () => (await call<readonly CoreWallpaper[]>("wallpapers_list")).map(toWallpaperItem),
    assignments: () => call("wallpapers_assignments"),
    assign: (monitorId, wallpaperId, fit) => call("wallpapers_assign", { monitorId, wallpaperId, fit }),
    importFile: () => call("wallpapers_import"),
    remove: (id) => call("wallpapers_remove", { id }),
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
    check: () => call("updater_check"),
    install: () => call("updater_install"),
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

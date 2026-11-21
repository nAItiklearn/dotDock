import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../providers/bridge";
import type { ShortcutAction } from "../model/types";
import type { DockAppName, DockSettings } from "./dock";

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
  /** Stage timings of the last start. `startedAt` is Unix ms; each stage's `ms` counts from process launch. */
  readonly lastBoot: { readonly startedAt: number; readonly stages: readonly BootStage[] } | null;
}

export type StartupToggle = "launchAtSignIn" | "hideDesktopIcons";

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

export interface UpdateStatus {
  /** Milliseconds since the Unix epoch of the last successful check. */
  readonly checkedAtMs: number | null;
  readonly available: { readonly version: string; readonly notes: string | null } | null;
  /** The last check could not reach the update service. */
  readonly failed: boolean;
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
    /** `wallpaper_current_image` () → raw file bytes. The picture Windows shows as the wallpaper; rejects for a solid colour. */
    currentImage(): Promise<Blob>;
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

  updater: {
    /** `updater_status` () → UpdateStatus */
    status(): Promise<UpdateStatus>;
    /** `updater_check` () → UpdateStatus */
    check(): Promise<UpdateStatus>;
    /** `updater_install` () → void. Downloads, verifies and runs the signed installer, which closes the app. */
    install(): Promise<void>;
  };

  dock: {
    /** `settings_dock_get` () → DockSettings, from the dock's own store. */
    get(): Promise<DockSettings>;
    /** `settings_dock_set` { settings: DockSettings } → DockSettings. A running dock applies it at once. */
    set(settings: DockSettings): Promise<DockSettings>;
    /** `settings_dock_apps` () → DockAppName[], the apps of the dock's last scan by name; empty before the first. */
    apps(): Promise<readonly DockAppName[]>;
  };

}

// ------------------------------------------------------------- implementations

const unavailable = (): Promise<never> => Promise.reject(new NativeUnavailableError());

export const unavailableNativeApi: NativeApi = {
  available: false,
  environment: { get: unavailable, setOn: unavailable, setWindowsTaskbar: unavailable, onChange: unavailable },
  startup: { get: unavailable, set: unavailable, restoreWindows: unavailable },
  displays: { list: unavailable },
  wallpapers: {
    list: unavailable,
    assignments: unavailable,
    assign: unavailable,
    importFile: unavailable,
    remove: unavailable,
    currentImage: unavailable,
  },
  shortcuts: { register: unavailable },
  window: { openSettings: unavailable, setEditMode: unavailable },
  app: { info: unavailable, openDataFolder: unavailable },
  updater: { status: unavailable, check: unavailable, install: unavailable },
  dock: { get: unavailable, set: unavailable, apps: unavailable },
};

const call = <T>(command: string, args?: Record<string, unknown>): Promise<T> => invoke<T>(command, args);

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
    restoreWindows: () => call("restore_windows"),
  },
  displays: { list: () => call("displays_list") },
  wallpapers: {
    list: () => call("wallpapers_list"),
    assignments: () => call("wallpapers_assignments"),
    assign: (monitorId, wallpaperId, fit) => call("wallpapers_assign", { monitorId, wallpaperId, fit }),
    importFile: () => call("wallpapers_import"),
    remove: (id) => call("wallpapers_remove", { id }),
    currentImage: async () => new Blob([await call<ArrayBuffer>("wallpaper_current_image")]),
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
  dock: {
    get: () => call("settings_dock_get"),
    set: (settings) => call("settings_dock_set", { settings }),
    apps: () => call("settings_dock_apps"),
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

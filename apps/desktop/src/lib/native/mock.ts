import type {
  AppInfo,
  DisplayInfo,
  NativeApi,
  RestoreReport,
  StartupState,
  WallpaperAssignment,
  WallpaperItem,
} from "./api";
import { DEFAULT_DOCK_SETTINGS, type DockSettings } from "./dock";

/**
 * Development-only stand-in for the Rust core, so the desktop-only Settings pages can be designed and
 * checked in a browser. It is reached only through `?native=mock` and is dropped from production builds.
 * Everything it returns is labelled as sample data.
 */
const LATENCY_MS = 120;
const later = <T>(value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));

/** Thumbnails of the app's own bundled wallpapers, served from the web assets as in the real app. */
const thumb = (id: string): string => `/wallpaper-thumbs/${id}.jpg`;

export function createMockNativeApi(): NativeApi {
  let startup: StartupState = {
    useOurDesktop: true,
    launchAtSignIn: true,
    hideDesktopIcons: false,
    startupDelayRemoved: true,
    lastBoot: {
      startedAt: Date.now() - 3_600_000,
      stages: [
        { name: "setup", ms: 612 },
        { name: "window-created", ms: 900 },
        { name: "overlay-ready", ms: 994 },
        { name: "shown", ms: 1025 },
      ],
    },
  };
  let dock: DockSettings = DEFAULT_DOCK_SETTINGS;
  let assignments: WallpaperAssignment[] = [
    { monitorId: "DISPLAY1", wallpaperId: "meadow-dots-dark", fit: "fill" },
    { monitorId: "DISPLAY2", wallpaperId: null, fit: "fill" },
  ];
  const wallpapers: WallpaperItem[] = [
    { id: "meadow-dots-dark", name: "Wind Meadow", source: "bundled", mode: "dark", accent: "#f2ee3a", thumbnailUrl: thumb("meadow-dots-dark") },
    { id: "meadow-dots-light", name: "Wind Meadow", source: "bundled", mode: "light", accent: "#f6d423", thumbnailUrl: thumb("meadow-dots-light") },
    { id: "liquid-gold-dark", name: "Molten Gold", source: "bundled", mode: "dark", accent: "#e0a93c", thumbnailUrl: thumb("liquid-gold-dark") },
    { id: "paper-ring-light", name: "Paper Ring", source: "bundled", mode: "light", accent: "#e2363d", thumbnailUrl: thumb("paper-ring-light") },
    { id: "halftone-ridge-dark", name: "Screen Ridge", source: "bundled", mode: "dark", accent: "#7aa346", thumbnailUrl: thumb("halftone-ridge-dark") },
  ];
  const displays: DisplayInfo[] = [
    {
      id: "DISPLAY1",
      name: "Built-in display",
      primary: true,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      scaleFactor: 1.25,
      refreshHz: 60,
    },
    {
      id: "DISPLAY2",
      name: "External monitor",
      primary: false,
      bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
      workArea: { x: 1920, y: 0, width: 2560, height: 1440 },
      scaleFactor: 1,
      refreshHz: 144,
    },
  ];
  const info: AppInfo = { version: "0.1.0", build: "dev sample", os: "Windows 11", webview: "WebView2", dataDir: "C:\\Users\\you\\AppData\\Roaming\\dev.dotdock.desktop" };

  return {
    available: true,
    startup: {
      get: () => later(startup),
      set: (setting, value) => {
        startup = { ...startup, [setting]: value };
        return later(startup);
      },
      restoreWindows: (): Promise<RestoreReport> => {
        startup = { ...startup, useOurDesktop: false, launchAtSignIn: false, hideDesktopIcons: false };
        return later({ wallpaperRestored: true, desktopIconsShown: false, autostartRemoved: true, startupDelayRestored: true });
      },
    },
    displays: { list: () => later(displays) },
    wallpapers: {
      list: () => later(wallpapers),
      assignments: () => later(assignments),
      assign: (monitorId, wallpaperId, fit) => {
        assignments = assignments.map((a) => (monitorId === "all" || a.monitorId === monitorId ? { ...a, wallpaperId, fit } : a));
        return later(assignments);
      },
      importFile: () => later(null),
      remove: (id) => {
        const index = wallpapers.findIndex((w) => w.id === id);
        if (index >= 0) wallpapers.splice(index, 1);
        return later(undefined);
      },
    },
    shortcuts: { register: () => later({ toggleEditMode: "ok", openSettings: "ok", nextProfile: "ok" }) },
    window: { openSettings: () => later(undefined), setEditMode: () => later(undefined) },
    app: { info: () => later(info), openDataFolder: () => later(undefined) },
    dock: {
      get: () => later(dock),
      set: (next) => {
        dock = next;
        return later(dock);
      },
    },
  };
}

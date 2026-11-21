import type {
  AppInfo,
  DisplayInfo,
  EnvironmentState,
  NativeApi,
  RestoreReport,
  StartupState,
  WallpaperAssignment,
  WallpaperItem,
} from "./api";
import { DEFAULT_DOCK_SETTINGS, type DockAppName, type DockSettings } from "./dock";

/**
 * Development-only stand-in for the Rust core, so the desktop-only Settings pages can be designed and
 * checked in a browser. It is reached only through `?native=mock` and is dropped from production builds.
 * Everything it returns is labelled as sample data.
 */
const LATENCY_MS = 120;
const later = <T>(value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));

/** Thumbnails of the app's own bundled wallpapers, served from the web assets as in the real app. */
const thumb = (id: string): string => `/wallpaper-thumbs/${id}.jpg`;

/** A sample picture for "use my wallpaper": a dusk sky over a dark ridge, drawn on the spot. */
function sampleWallpaper(): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("no canvas"));
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#1b2a5a");
  sky.addColorStop(0.6, "#c4553f");
  sky.addColorStop(1, "#f2b04a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0d0f1a";
  ctx.beginPath();
  ctx.moveTo(0, 150);
  ctx.lineTo(80, 110);
  ctx.lineTo(160, 140);
  ctx.lineTo(250, 95);
  ctx.lineTo(320, 130);
  ctx.lineTo(320, 180);
  ctx.lineTo(0, 180);
  ctx.fill();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no image"))), "image/png"));
}

export function createMockNativeApi(): NativeApi {
  // This build has no taskbar replacement yet, so the Windows taskbar always stays.
  let environment: EnvironmentState = { on: true, windowsTaskbar: true, taskbarReplacement: false, problems: [] };
  const listeners = new Set<(state: EnvironmentState) => void>();
  const setEnvironment = (patch: Partial<EnvironmentState>): EnvironmentState => {
    environment = { ...environment, ...patch };
    listeners.forEach((listener) => listener(environment));
    return environment;
  };
  let startup: StartupState = {
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
  let dock: DockSettings = {
    ...DEFAULT_DOCK_SETTINGS,
    pinned: [
      { kind: "app", id: "sample.files" },
      { kind: "app", id: "sample.browser" },
      { kind: "stack", category: "dev" },
    ],
    tiles: ["clock", "media", "system"],
  };
  const dockApps: DockAppName[] = [
    { id: "sample.browser", name: "Sample browser" },
    { id: "sample.files", name: "Sample file manager" },
    { id: "sample.terminal", name: "Sample terminal" },
  ];
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
    environment: {
      get: () => later(environment),
      setOn: (on) => later(setEnvironment({ on })),
      setWindowsTaskbar: (windowsTaskbar) => later(setEnvironment({ windowsTaskbar: windowsTaskbar || !environment.taskbarReplacement })),
      onChange: (handler) => {
        listeners.add(handler);
        return Promise.resolve(() => listeners.delete(handler));
      },
    },
    startup: {
      get: () => later(startup),
      set: (setting, value) => {
        startup = { ...startup, [setting]: value };
        return later(startup);
      },
      restoreWindows: (): Promise<RestoreReport> => {
        startup = { ...startup, launchAtSignIn: false, hideDesktopIcons: false };
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
      currentImage: sampleWallpaper,
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
      apps: () => later(dockApps),
    },
  };
}

import type {
  AppInfo,
  DisplayInfo,
  NativeApi,
  PerformanceSettings,
  RestoreReport,
  StartupState,
  UpdateStatus,
  WallpaperAssignment,
  WallpaperItem,
} from "./api";

/**
 * Development-only stand-in for the Rust core, so the desktop-only Settings pages can be designed and
 * checked in a browser. It is reached only through `?native=mock` and is dropped from production builds.
 * Everything it returns is labelled as sample data.
 */
const LATENCY_MS = 120;
const later = <T>(value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));

const swatch = (from: string, to: string): string =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="160" height="100" fill="url(#g)"/></svg>`)}`;

export function createMockNativeApi(): NativeApi {
  let startup: StartupState = {
    useOurDesktop: true,
    launchAtSignIn: true,
    hideDesktopIcons: false,
    startupDelayRemoved: true,
    safeMode: false,
    lastBoot: {
      startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      stages: [
        { name: "Process start to window created", ms: 612 },
        { name: "Webview ready", ms: 288 },
        { name: "Layout and cached data painted", ms: 94 },
        { name: "Overlay shown", ms: 31 },
      ],
    },
  };
  let performance: PerformanceSettings = { pauseOnFullscreen: true, pauseOnBatterySaver: false, pauseWhenLocked: true, systemRefreshHz: 1 };
  let updates: UpdateStatus = { enabled: true, checkedAt: new Date(Date.now() - 86_400_000).toISOString(), available: null };
  let assignments: WallpaperAssignment[] = [
    { monitorId: "DISPLAY1", wallpaperId: "sample-ink", fit: "fill" },
    { monitorId: "DISPLAY2", wallpaperId: null, fit: "fill" },
  ];
  const wallpapers: WallpaperItem[] = [
    { id: "sample-ink", name: "Sample ink", source: "bundled", thumbnailUrl: swatch("#2b2b2b", "#8a8a86") },
    { id: "sample-gold", name: "Sample gold", source: "bundled", thumbnailUrl: swatch("#1c1a16", "#e2b453") },
    { id: "sample-paper", name: "Sample paper", source: "bundled", thumbnailUrl: swatch("#e8e6e3", "#dcdad6") },
    { id: "sample-mine", name: "Sample import", source: "imported", thumbnailUrl: swatch("#e94248", "#111111") },
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
  let tick = 0;

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
    performance: {
      get: () => later(performance),
      set: (patch) => {
        performance = { ...performance, ...patch };
        return later(performance);
      },
      stats: () => {
        tick += 1;
        return later({ overlayFps: 60, frameP95Ms: 8.4 + (tick % 3) * 0.3, cpuPercent: 0.4 + (tick % 4) * 0.1, workingSetMb: 142 });
      },
    },
    shortcuts: { register: () => later({ toggleEditMode: "ok", openSettings: "ok", nextProfile: "ok" }) },
    window: { openSettings: () => later(undefined) },
    app: { info: () => later(info), openDataFolder: () => later(undefined) },
    updater: {
      status: () => later(updates),
      setEnabled: (enabled) => {
        updates = { ...updates, enabled };
        return later(updates);
      },
      check: () => {
        updates = { ...updates, checkedAt: new Date().toISOString() };
        return later(updates);
      },
    },
  };
}

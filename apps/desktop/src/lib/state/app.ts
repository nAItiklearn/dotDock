import { createCommandBus, type CommandBus } from "../bus";
import { PRIMARY_MONITOR, type Bounds, type MonitorId, type WidgetCatalogMeta } from "../model/types";
import { createDefaultBackend, type StorageBackend } from "../storage/backend";
import { createLayoutStore, type LayoutStore } from "./layoutStore";
import { LayoutRepository } from "./layoutRepo";
import { createNoticeStore, type NoticeStore } from "./notices";
import { createSettingsStore, type SettingsStore } from "./settingsStore";

/** Grid extent used until a view measures its window; large enough that nothing is clamped before then. */
const UNMEASURED_BOUNDS: Bounds = { cols: 64, rows: 64 };

export interface AppOptions {
  readonly catalog: WidgetCatalogMeta;
  readonly monitorId?: MonitorId;
  readonly isPrimary?: boolean;
  readonly backend?: StorageBackend;
  /** Cross-window command channel; defaults to the Tauri event bus or a BroadcastChannel. */
  readonly bus?: CommandBus;
}

export interface AppContext {
  readonly backend: StorageBackend;
  readonly catalog: WidgetCatalogMeta;
  readonly monitorId: MonitorId;
  readonly isPrimary: boolean;
  readonly notices: NoticeStore;
  readonly settings: SettingsStore;
  readonly layout: LayoutStore;
  readonly repo: LayoutRepository;
  readonly bus: CommandBus;
  /** Loads settings and the active profile. Resolves when the first frame can be final. */
  start(): Promise<void>;
}

/** Which display this window belongs to, from the `monitor` and `primary` URL parameters the core sets. */
export function displayFromLocation(search: string): { monitorId: MonitorId; isPrimary: boolean } {
  const params = new URLSearchParams(search);
  const monitorId = params.get("monitor") ?? PRIMARY_MONITOR;
  return { monitorId, isPrimary: monitorId === PRIMARY_MONITOR || params.get("primary") === "1" };
}

export function createApp(options: AppOptions): AppContext {
  const backend = options.backend ?? createDefaultBackend();
  const monitorId = options.monitorId ?? PRIMARY_MONITOR;
  const isPrimary = options.isPrimary ?? monitorId === PRIMARY_MONITOR;
  const notices = createNoticeStore();
  const notify = notices.getState().push;

  // The repository needs profile names for its messages and the settings store needs the repository.
  // A late-bound lookup breaks the cycle without either knowing about the other.
  let settingsRef: SettingsStore | null = null;
  const profileLabel = (id: string): string => settingsRef?.getState().settings.profiles.find((p) => p.id === id)?.name ?? id;
  const repo = new LayoutRepository(backend, notify, profileLabel);
  const settings = createSettingsStore({ backend, repo, notify });
  settingsRef = settings;

  const layout = createLayoutStore({
    backend,
    repo,
    catalog: options.catalog,
    getSettings: () => settings.getState().settings,
    notify,
    monitorId,
    isPrimary,
    initialBounds: UNMEASURED_BOUNDS,
  });

  // One profile at a time: when the active profile changes anywhere, this window follows.
  settings.subscribe((state, previous) => {
    if (previous.ready && state.settings.activeProfileId !== previous.settings.activeProfileId) {
      void layout.getState().loadProfile(state.settings.activeProfileId);
    }
  });

  return {
    backend,
    catalog: options.catalog,
    monitorId,
    isPrimary,
    notices,
    settings,
    layout,
    repo,
    bus: options.bus ?? createCommandBus(),
    async start() {
      await settings.getState().init();
      await layout.getState().init(settings.getState().settings.activeProfileId);
    },
  };
}

let current: AppContext | null = null;

/** Creates the app for this page. Called once, from the page's entry file. */
export function initApp(options: AppOptions): AppContext {
  current = createApp(options);
  window.addEventListener("pagehide", () => {
    void current?.settings.getState().flush();
    void current?.layout.getState().exitEdit();
  });
  return current;
}

export function getApp(): AppContext {
  if (!current) throw new Error("initApp() must run before the app is used");
  return current;
}

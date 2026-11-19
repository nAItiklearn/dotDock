import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../providers/bridge";
import {
  CMD,
  EVENT_POINTER,
  EVENT_SETTINGS,
  EVENT_SNAPSHOT,
  type ConnectionStatus,
  type FocusOutcome,
  type InitialState,
  type IslandSettings,
  type PointerEvent,
  type Regions,
  type Snapshot,
} from "./protocol";
import { useIslandStore } from "./store";

/** Everything the island needs from the outside world. The Tauri core provides it; a browser has nothing. */
export interface IslandBackend {
  loadInitial: () => Promise<InitialState | null>;
  /** Subscribes to pushed updates and returns the unsubscribe function. */
  subscribe: (handlers: Handlers) => Promise<() => void>;
  setRegions: (regions: Regions) => void;
  focus: (id: string) => Promise<FocusOutcome>;
  dismiss: (id: string) => void;
  connect: () => Promise<ConnectionStatus>;
  disconnect: () => Promise<ConnectionStatus>;
  saveSettings: (settings: IslandSettings) => void;
  ready: () => void;
}

export interface Handlers {
  readonly snapshot: (snapshot: Snapshot) => void;
  readonly settings: (settings: IslandSettings) => void;
  readonly pointer: (inside: boolean) => void;
}

/** IPC failures are never fatal for the UI but must be visible in devtools. */
function fireAndForget(command: string, args?: Record<string, unknown>): void {
  invoke(command, args).catch((err: unknown) => console.error(`${command} failed`, err));
}

const tauriBackend: IslandBackend = {
  loadInitial: () => invoke<InitialState>(CMD.state),
  subscribe: async (handlers) => {
    const offs = await Promise.all([
      listen<Snapshot>(EVENT_SNAPSHOT, (e) => handlers.snapshot(e.payload)),
      listen<IslandSettings>(EVENT_SETTINGS, (e) => handlers.settings(e.payload)),
      listen<PointerEvent>(EVENT_POINTER, (e) => handlers.pointer(e.payload.inside)),
    ]);
    return () => offs.forEach((off) => off());
  },
  setRegions: (regions) => fireAndForget(CMD.setRegions, { regions }),
  focus: (id) => invoke<FocusOutcome>(CMD.focus, { id }),
  dismiss: (id) => fireAndForget(CMD.dismiss, { id }),
  connect: () => invoke<ConnectionStatus>(CMD.connect),
  disconnect: () => invoke<ConnectionStatus>(CMD.disconnect),
  saveSettings: (settings) => fireAndForget(CMD.setSettings, { settings }),
  ready: () => fireAndForget(CMD.ready),
};

/** A plain browser has no agent data and nothing to connect to; settings still apply to the local store. */
const detachedBackend: IslandBackend = {
  loadInitial: () => Promise.resolve(null),
  subscribe: () => Promise.resolve(() => undefined),
  setRegions: () => undefined,
  focus: () => Promise.resolve("window-not-found"),
  dismiss: () => undefined,
  connect: () => Promise.reject(new Error("No Claude Code connection in a plain browser")),
  disconnect: () => Promise.reject(new Error("No Claude Code connection in a plain browser")),
  saveSettings: () => undefined,
  ready: () => undefined,
};

let backend: IslandBackend = isTauri() ? tauriBackend : detachedBackend;

/** Lets the dev-only fixture panel stand in for the core. Never called in production code paths. */
export function setBackend(next: IslandBackend): void {
  backend = next;
}

let connected: Promise<() => void> | null = null;

/**
 * Loads the initial state and starts listening for pushes. Safe to call from every component that
 * needs data: the first call does the work, later calls share it.
 */
export function connectIsland(): Promise<() => void> {
  connected ??= start();
  return connected;
}

async function start(): Promise<() => void> {
  const store = useIslandStore.getState();
  const off = await backend.subscribe({
    snapshot: store.applySnapshot,
    settings: store.applySettings,
    pointer: store.setPointerInside,
  });
  const initial = await backend.loadInitial();
  if (initial) {
    store.applySnapshot(initial.snapshot);
    store.applySettings(initial.settings);
    store.applyConnection(initial.connection);
  }
  return off;
}

export const actions = {
  ready: (): void => backend.ready(),
  reportRegions: (regions: Regions): void => backend.setRegions(regions),
  dismiss: (id: string): void => backend.dismiss(id),

  /** Asks the core to bring the session's terminal forward and shows why when it cannot. */
  async focus(id: string): Promise<void> {
    try {
      const outcome = await backend.focus(id);
      if (outcome === "focused") return;
      useIslandStore.getState().setFlash({ sessionId: id, kind: outcome === "session-ended" ? "session-ended" : "window-not-found" });
    } catch (err) {
      console.error("island_focus failed", err);
      useIslandStore.getState().setFlash({ sessionId: id, kind: "window-not-found" });
    }
  },

  /** Applies a settings change at once and hands it to the core, which validates, stores and echoes it back. */
  updateSettings(patch: Partial<IslandSettings>): void {
    const next: IslandSettings = { ...useIslandStore.getState().settings, ...patch };
    useIslandStore.getState().applySettings(next);
    backend.saveSettings(next);
  },

  async connect(): Promise<void> {
    useIslandStore.getState().applyConnection(await backend.connect());
  },

  async disconnect(): Promise<void> {
    useIslandStore.getState().applyConnection(await backend.disconnect());
  },
};

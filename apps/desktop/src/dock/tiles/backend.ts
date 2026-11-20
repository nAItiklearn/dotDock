import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../providers/bridge";
import { useDockStore } from "../store";
import { t } from "../strings";
import type { FeedName, TileFeeds, TilesBackend, TilesCommands, Unsubscribe } from "./ui-types";

/**
 * The wire names between the tiles and the core (see `docs/dock/CONTRACT.md`, "Tiles"). Rust mirrors the payloads
 * with serde `rename_all = "camelCase"`. A command the core does not have yet rejects, and a feed it does not
 * have yet is reported `unsupported`, so a tile always shows a designed state and never an empty box.
 */
export const TILES_WIRE = {
  watch: "dock_tiles_watch",
  unwatch: "dock_tiles_unwatch",
  feedEvent: "dock://tiles",
  micWatch: "dock_mic_watch",
  micUnwatch: "dock_mic_unwatch",
  micEvent: "dock://mic-level",
  contact: "dock_contact",
  joinMeeting: "dock_join_meeting",
  stopwatch: "dock_stopwatch",
  toggleMic: "dock_toggle_mic",
  hydration: "dock_hydration",
  audio: "dock_audio",
  toggles: "dock_toggles",
} as const;

async function run(name: string, args: Record<string, unknown>): Promise<void> {
  try {
    await invoke(name, args);
  } catch (err) {
    throw new Error(String(err));
  }
}

const tauriCommands: TilesCommands = {
  contact: (id, action) => run(TILES_WIRE.contact, { id, action }),
  joinMeeting: (url) => run(TILES_WIRE.joinMeeting, { url }),
  stopwatch: (op) => run(TILES_WIRE.stopwatch, { op }),
  toggleMic: () => run(TILES_WIRE.toggleMic, {}),
  hydration: (op) => run(TILES_WIRE.hydration, { op }),
  audio: (op) => run(TILES_WIRE.audio, { op }),
  toggles: (op) => run(TILES_WIRE.toggles, { op }),
};

/** What a feed reads as while the core cannot supply it. */
const unsupported = (names: readonly FeedName[]): Partial<TileFeeds> =>
  Object.fromEntries(names.map((name) => [name, { data: null, issue: "unsupported" }]));

/**
 * Starts `start`, which returns a promise of its own cleanup, and returns the cleanup at once: a cleanup that is
 * called before the promise settles still runs the moment it does.
 */
export function releasing(start: () => Promise<Unsubscribe>): Unsubscribe {
  let live = true;
  let off: Unsubscribe | null = null;
  start().then(
    (cleanup) => {
      if (live) off = cleanup;
      else cleanup();
    },
    (err: unknown) => console.error("a dock tile feed failed to start", err),
  );
  return () => {
    live = false;
    off?.();
    off = null;
  };
}

const tauriTiles: TilesBackend = {
  commands: tauriCommands,
  subscribe: (names, listener) =>
    releasing(async () => {
      const off = await listen<Partial<TileFeeds>>(TILES_WIRE.feedEvent, (e) => listener(e.payload));
      try {
        await invoke(TILES_WIRE.watch, { feeds: names });
      } catch {
        // The core predates the feeds: say so instead of leaving the tiles waiting.
        listener(unsupported(names));
      }
      return () => {
        off();
        invoke(TILES_WIRE.unwatch).catch(() => undefined);
      };
    }),
  watchMicLevel: (listener) =>
    releasing(async () => {
      const off = await listen<number>(TILES_WIRE.micEvent, (e) => listener(e.payload));
      await invoke(TILES_WIRE.micWatch).catch(() => undefined);
      return () => {
        off();
        invoke(TILES_WIRE.micUnwatch).catch(() => undefined);
      };
    }),
};

/** A plain browser outside `vite dev` has no core: every feed is unsupported and every command says why. */
const detachedTiles: TilesBackend = {
  commands: {
    contact: () => Promise.reject(new Error("no core")),
    joinMeeting: () => Promise.reject(new Error("no core")),
    stopwatch: () => Promise.reject(new Error("no core")),
    toggleMic: () => Promise.reject(new Error("no core")),
    hydration: () => Promise.reject(new Error("no core")),
    audio: () => Promise.reject(new Error("no core")),
    toggles: () => Promise.reject(new Error("no core")),
  },
  subscribe: (names, listener) => {
    queueMicrotask(() => listener(unsupported(names)));
    return () => undefined;
  },
  watchMicLevel: () => () => undefined,
};

let backend: TilesBackend = isTauri() ? tauriTiles : detachedTiles;

export const tilesBackend = (): TilesBackend => backend;

/** Lets the dev-only fixture stand in for the core. Never called in production code paths. */
export function setTilesBackend(next: TilesBackend): void {
  backend = next;
}

/**
 * Runs a command a tile issued. A rejection shows the dock's notice, so a button never fails silently; the
 * returned promise always resolves, with whether the command worked.
 */
export async function runTileCommand(command: Promise<void>): Promise<boolean> {
  try {
    await command;
    return true;
  } catch (err) {
    console.error("a dock tile command failed", err);
    useDockStore.getState().setNotice(t("tile.failed"));
    return false;
  }
}

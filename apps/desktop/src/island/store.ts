import { create } from "zustand";
import { DEFAULT_SETTINGS, type ConnectionStatus, type IslandSettings, type SessionView, type Snapshot } from "./protocol";
import { directionBetween, pruneUnavailablePin, resolveCurrent, stepSession } from "./selection";

/** Why a click on the island could not bring a terminal forward. Shown for a moment, then cleared. */
export type FlashKind = "window-not-found" | "session-ended";

export interface Flash {
  readonly sessionId: string;
  readonly kind: FlashKind;
}

export const EMPTY_SNAPSHOT: Snapshot = { seq: 0, sessions: [], current: null };

interface IslandStore {
  readonly snapshot: Snapshot;
  readonly settings: IslandSettings;
  /** Null until the core reports it, and always null in a plain browser. */
  readonly connection: ConnectionStatus | null;
  /** Session the user picked with the pager; falls back to the core's suggestion once it disappears. */
  readonly pinnedId: string | null;
  /** Direction of the latest session switch, for the slide of the content swap. */
  readonly direction: 1 | -1;
  /** Cursor is over the island's resting footprint. */
  readonly pointerInside: boolean;
  readonly flash: Flash | null;
  applySnapshot: (snapshot: Snapshot) => void;
  applySettings: (settings: IslandSettings) => void;
  applyConnection: (connection: ConnectionStatus | null) => void;
  pin: (id: string) => void;
  step: (step: -1 | 1) => void;
  setPointerInside: (inside: boolean) => void;
  setFlash: (flash: Flash | null) => void;
}

export const useIslandStore = create<IslandStore>((set, get) => ({
  snapshot: EMPTY_SNAPSHOT,
  settings: DEFAULT_SETTINGS,
  connection: null,
  pinnedId: null,
  direction: 1,
  pointerInside: false,
  flash: null,
  applySnapshot: (snapshot) => {
    const { pinnedId, flash } = get();
    const pin = pruneUnavailablePin(snapshot, pinnedId);
    const stillVisible = flash !== null && snapshot.sessions.some((s) => s.id === flash.sessionId);
    set({ snapshot, pinnedId: pin, flash: stillVisible ? flash : null });
  },
  applySettings: (settings) => set({ settings }),
  applyConnection: (connection) => set({ connection }),
  pin: (id) => {
    const { snapshot, pinnedId } = get();
    const from = resolveCurrent(snapshot, pinnedId)?.id ?? null;
    set({ pinnedId: id, direction: directionBetween(snapshot, from, id) });
  },
  step: (step) => {
    const { snapshot, pinnedId } = get();
    const from = resolveCurrent(snapshot, pinnedId)?.id ?? null;
    const target = stepSession(snapshot, from, step);
    if (target !== null) set({ pinnedId: target, direction: step });
  },
  setPointerInside: (pointerInside) => set((s) => (s.pointerInside === pointerInside ? s : { pointerInside })),
  setFlash: (flash) => set({ flash }),
}));

/** The session on screen right now, or null while the island is idle. */
export function useCurrentSession(): SessionView | null {
  return useIslandStore((s) => resolveCurrent(s.snapshot, s.pinnedId));
}

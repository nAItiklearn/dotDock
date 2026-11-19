import { create } from "zustand";
import { readChoice, saveChoice, type EffectsChoice } from "./effects";
import type { Rect } from "./geometry";
import type { Category, CategoryId, DockApp, DockSettings, DockSnapshot, DockWindow } from "./protocol";

export const DEFAULT_SETTINGS: DockSettings = {
  schema: 1,
  enabled: true,
  replaceTaskbar: false,
  edge: "bottom",
  reserveSpace: true,
  autoHide: false,
  iconSize: 48,
  magnification: 1.7,
  pinned: [],
  tiles: [],
};

/** A command that failed, shown for a moment above the dock. */
export interface Notice {
  readonly id: number;
  readonly text: string;
}

export interface OpenStack {
  readonly category: CategoryId;
  /** Where the tile was drawn when it was opened: the popover grows out of this rect. */
  readonly from: Rect;
}

export interface MenuTarget {
  /** Entry key the menu belongs to, or null for the bar itself. */
  readonly key: string | null;
  /** Window position the menu opens at. */
  readonly at: { readonly x: number; readonly y: number };
}

const SEEN_KEY = "dotdock.dock.seen";

function readSeen(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSeen(seen: ReadonlySet<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // Storage full or unavailable: the badge simply shows again next start.
  }
}

interface DockStore {
  /** False until the core has sent its first snapshot. */
  readonly ready: boolean;
  readonly categories: readonly Category[];
  readonly apps: readonly DockApp[];
  readonly windows: readonly DockWindow[];
  readonly settings: DockSettings;
  readonly seen: ReadonlySet<string>;

  readonly stack: OpenStack | null;
  readonly libraryOpen: boolean;
  readonly editing: boolean;
  readonly menu: MenuTarget | null;
  readonly notice: Notice | null;
  /** The cursor is inside the dock's click regions (reported by the core, or measured in a browser). */
  readonly pointerInside: boolean;
  /** Entry key under the pointer, for the label and the window preview. */
  readonly hoveredKey: string | null;
  /** Entry whose window preview is open. */
  readonly previewKey: string | null;
  /** The core froze the dock (display off, locked, fullscreen app, auto-hidden): no frames, no timers. */
  readonly frozen: boolean;
  /** The user's choice for visual effects; "auto" lets the capability check decide. */
  readonly effectsChoice: EffectsChoice;

  applySnapshot: (snapshot: DockSnapshot) => void;
  applyApps: (apps: readonly DockApp[]) => void;
  applyWindows: (windows: readonly DockWindow[]) => void;
  applySettings: (settings: DockSettings) => void;
  setApps: (apps: readonly DockApp[]) => void;
  markSeen: (ids: readonly string[]) => void;
  openStack: (stack: OpenStack | null) => void;
  setLibrary: (open: boolean) => void;
  setEditing: (editing: boolean) => void;
  setMenu: (menu: MenuTarget | null) => void;
  setNotice: (text: string | null) => void;
  setPointerInside: (inside: boolean) => void;
  setHovered: (key: string | null) => void;
  setPreviewKey: (key: string | null) => void;
  setFrozen: (frozen: boolean) => void;
  setEffectsChoice: (choice: EffectsChoice) => void;
}

let noticeId = 0;

export const useDockStore = create<DockStore>((set, get) => ({
  ready: false,
  categories: [],
  apps: [],
  windows: [],
  settings: DEFAULT_SETTINGS,
  seen: readSeen(),

  stack: null,
  libraryOpen: false,
  editing: false,
  menu: null,
  notice: null,
  pointerInside: false,
  hoveredKey: null,
  previewKey: null,
  frozen: false,
  effectsChoice: readChoice(),

  applySnapshot: (snapshot) =>
    set({ ready: true, categories: snapshot.categories, apps: snapshot.apps, windows: snapshot.windows, settings: snapshot.settings }),
  applyApps: (apps) => set({ apps }),
  applyWindows: (windows) => set({ windows }),
  applySettings: (settings) => set({ settings }),
  setApps: (apps) => set({ apps }),
  markSeen: (ids) => {
    const { seen } = get();
    if (ids.every((id) => seen.has(id))) return;
    const next = new Set([...seen, ...ids]);
    writeSeen(next);
    set({ seen: next });
  },
  openStack: (stack) => set({ stack, menu: null }),
  setLibrary: (libraryOpen) => set({ libraryOpen, stack: null, menu: null }),
  setEditing: (editing) => set({ editing, menu: null }),
  setMenu: (menu) => set({ menu }),
  setNotice: (text) => set({ notice: text === null ? null : { id: ++noticeId, text } }),
  setPointerInside: (pointerInside) => set({ pointerInside }),
  setHovered: (hoveredKey) => (get().hoveredKey === hoveredKey ? undefined : set({ hoveredKey })),
  setPreviewKey: (previewKey) => (get().previewKey === previewKey ? undefined : set({ previewKey })),
  setFrozen: (frozen) => (get().frozen === frozen ? undefined : set({ frozen })),
  setEffectsChoice: (effectsChoice) => {
    saveChoice(effectsChoice);
    set({ effectsChoice });
  },
}));

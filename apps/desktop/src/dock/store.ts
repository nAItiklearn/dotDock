import { create } from "zustand";
import { readChoice, saveChoice, type EffectsChoice } from "./effects";
import type { PopoverTileId, Rect } from "./geometry";
import { appsInCategory, freshAppIds } from "./model";
import type { Category, CategoryId, DockApp, DockSettings, DockSnapshot, DockWindow, FrozenState } from "./protocol";
import { DEFAULT_BACKDROP, readThemeChoice, saveThemeChoice, type Backdrop, type DockThemeId } from "./theme";

export const DEFAULT_SETTINGS: DockSettings = {
  schema: 1,
  enabled: true,
  replaceTaskbar: false,
  edge: "bottom",
  reserveSpace: true,
  autoHide: false,
  iconSize: 48,
  magnification: 1.25,
  pinned: [],
  tiles: [],
};

/** Whether the dock should stop drawing and ticking: any one of the core's reasons is enough. */
export const isFrozen = (state: FrozenState): boolean => state.locked || state.displayOff || state.fullscreen;

/** A command that failed, shown for a moment above the dock. */
export interface Notice {
  readonly id: number;
  readonly text: string;
}

export interface OpenStack {
  readonly category: CategoryId;
  /** Where the tile was drawn when it was opened: the popover grows out of this rect. */
  readonly from: Rect;
  /** Apps that were new when it opened. Opening marks them seen, so the popover keeps its own copy. */
  readonly fresh: ReadonlySet<string>;
}

export interface OpenTile {
  readonly id: PopoverTileId;
  /** Where the tile was drawn when it was opened: the popover sits beside it. */
  readonly from: Rect;
}

export interface OpenGallery {
  /** Where it was opened from (the "+" in edit mode, or the bar): the gallery sits beside it. */
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
  readonly tile: OpenTile | null;
  readonly gallery: OpenGallery | null;
  readonly libraryOpen: boolean;
  readonly editing: boolean;
  readonly menu: MenuTarget | null;
  readonly notice: Notice | null;
  /** The cursor is inside the dock's click regions (reported by the core, or measured in a browser). */
  readonly pointerInside: boolean;
  /** Entry whose window preview is open. */
  readonly previewKey: string | null;
  /** The core froze the dock (display off, locked, fullscreen app, auto-hidden): no frames, no timers. */
  readonly frozen: boolean;
  /** The user's choice for visual effects; "auto" lets the capability check decide. */
  readonly effectsChoice: EffectsChoice;
  /** The theme the user chose for the dock; glass may be drawn as glass-lite when it cannot be done (theme.ts). */
  readonly themeChoice: DockThemeId;
  /** What the core says about the area behind the dock. */
  readonly backdrop: Backdrop;

  applySnapshot: (snapshot: DockSnapshot) => void;
  applyApps: (apps: readonly DockApp[]) => void;
  applyWindows: (windows: readonly DockWindow[]) => void;
  applySettings: (settings: DockSettings) => void;
  setApps: (apps: readonly DockApp[]) => void;
  markSeen: (ids: readonly string[]) => void;
  openStack: (stack: OpenStack | null) => void;
  /** Opens a live tile's popover beside the tile, or closes it with null. */
  showTile: (tile: OpenTile | null) => void;
  /** Opens the widget gallery, or closes it with null. */
  showGallery: (gallery: OpenGallery | null) => void;
  /** Opens a category's stack: notes which of its apps are new, then marks them seen. */
  showStack: (category: CategoryId, from: Rect) => void;
  setLibrary: (open: boolean) => void;
  setEditing: (editing: boolean) => void;
  setMenu: (menu: MenuTarget | null) => void;
  setNotice: (text: string | null) => void;
  setPointerInside: (inside: boolean) => void;
  setPreviewKey: (key: string | null) => void;
  setFrozen: (frozen: boolean) => void;
  setEffectsChoice: (choice: EffectsChoice) => void;
  setThemeChoice: (choice: DockThemeId) => void;
  setBackdrop: (backdrop: Backdrop) => void;
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
  tile: null,
  gallery: null,
  libraryOpen: false,
  editing: false,
  menu: null,
  notice: null,
  pointerInside: false,
  previewKey: null,
  frozen: false,
  effectsChoice: readChoice(),
  themeChoice: readThemeChoice(),
  backdrop: DEFAULT_BACKDROP,

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
  openStack: (stack) => set(stack === null ? { stack, menu: null } : { stack, menu: null, tile: null, gallery: null }),
  showTile: (tile) => set(tile === null ? { tile } : { tile, stack: null, menu: null, gallery: null }),
  showGallery: (gallery) => set(gallery === null ? { gallery } : { gallery, stack: null, tile: null, menu: null, libraryOpen: false }),
  showStack: (category, from) => {
    const { apps, seen } = get();
    const inStack = appsInCategory(apps, category);
    const fresh = freshAppIds(inStack, seen, Date.now());
    get().markSeen(inStack.map((a) => a.id));
    set({ stack: { category, from, fresh }, menu: null, tile: null, gallery: null });
  },
  setLibrary: (libraryOpen) => set({ libraryOpen, stack: null, tile: null, gallery: null, menu: null }),
  setEditing: (editing) => set(editing ? { editing, menu: null, tile: null } : { editing, menu: null }),
  setMenu: (menu) => set(menu === null ? { menu } : { menu, tile: null }),
  setNotice: (text) => set({ notice: text === null ? null : { id: ++noticeId, text } }),
  setPointerInside: (pointerInside) => set({ pointerInside }),
  setPreviewKey: (previewKey) => (get().previewKey === previewKey ? undefined : set({ previewKey })),
  setFrozen: (frozen) => (get().frozen === frozen ? undefined : set({ frozen })),
  setEffectsChoice: (effectsChoice) => {
    saveChoice(effectsChoice);
    set({ effectsChoice });
  },
  setThemeChoice: (themeChoice) => {
    saveThemeChoice(themeChoice);
    set({ themeChoice });
  },
  setBackdrop: (backdrop) => set({ backdrop }),
}));

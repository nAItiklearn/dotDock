/**
 * The dock's settings as Settings edits them. Mirrors `DockSettings` in the dock contract
 * (`src-tauri/dock/src/protocol.rs`, `src/dock/protocol.ts` on the dock branch) field for field, and the
 * dock's own limits and themes, so a value chosen here is one the dock draws exactly as chosen.
 */

export type DockEdge = "bottom" | "top" | "left" | "right";

export type PinnedItem = { readonly kind: "app"; readonly id: string } | { readonly kind: "stack"; readonly category: string };

export interface DockSettings {
  readonly schema: 1;
  /** Decided by the dotDock theme switch (the dock runs while the theme is on); never edited here. */
  readonly enabled: boolean;
  readonly replaceTaskbar: boolean;
  /** Always "bottom": the dock sits at the bottom only (owner, 2026-11-21). Passed through, never edited. */
  readonly edge: DockEdge;
  /** Keep maximised windows clear of the dock (an app bar) instead of floating over them. */
  readonly reserveSpace: boolean;
  readonly autoHide: boolean;
  /** Icon size in px at 100 % scaling. */
  readonly iconSize: number;
  /** Peak magnification factor; 1 turns it off. */
  readonly magnification: number;
  readonly pinned: readonly PinnedItem[];
  /** Live tile ids shown on the right, in order. */
  readonly tiles: readonly string[];
}

/** An app the dock has seen, as `settings_dock_apps` returns it. */
export interface DockAppName {
  readonly id: string;
  readonly name: string;
}

/** The dock's own clamps (`src/dock/geometry.ts`): it never draws outside these. */
export const DOCK_ICON_LIMITS = { min: 32, max: 80, step: 2, default: 48 } as const;
export const DOCK_MAGNIFICATION_LIMITS = { min: 1, max: 1.6, step: 0.05, default: 1.6 } as const;

/** Defaults of a fresh install (`DockSettings::default` in the core). */
export const DEFAULT_DOCK_SETTINGS: DockSettings = {
  schema: 1,
  enabled: true,
  replaceTaskbar: false,
  edge: "bottom",
  reserveSpace: true,
  autoHide: true,
  iconSize: DOCK_ICON_LIMITS.default,
  magnification: DOCK_MAGNIFICATION_LIMITS.default,
  pinned: [],
  tiles: [],
};

/** How the dock bar is drawn (`src/dock/theme.ts`). */
export const DOCK_THEMES = ["glass", "glass-lite", "obsidian", "paper", "aurum", "minimal"] as const;
export type DockThemeId = (typeof DOCK_THEMES)[number];
export const DEFAULT_DOCK_THEME: DockThemeId = "glass";
/** The dock window reads its theme from this key; Settings and the dock share the app's storage. */
export const DOCK_THEME_STORAGE_KEY = "dotdock.dock.theme";

export const isDockTheme = (value: string | null): value is DockThemeId => value !== null && (DOCK_THEMES as readonly string[]).includes(value);

export function readDockTheme(storage: Pick<Storage, "getItem"> = localStorage): DockThemeId {
  try {
    const stored = storage.getItem(DOCK_THEME_STORAGE_KEY);
    return isDockTheme(stored) ? stored : DEFAULT_DOCK_THEME;
  } catch {
    return DEFAULT_DOCK_THEME;
  }
}

export function saveDockTheme(theme: DockThemeId, storage: Pick<Storage, "setItem"> = localStorage): void {
  storage.setItem(DOCK_THEME_STORAGE_KEY, theme);
}

export const clampIconSize = (size: number): number =>
  Number.isFinite(size) ? Math.min(DOCK_ICON_LIMITS.max, Math.max(DOCK_ICON_LIMITS.min, Math.round(size))) : DOCK_ICON_LIMITS.default;

export const clampMagnification = (factor: number): number =>
  Number.isFinite(factor) ? Math.min(DOCK_MAGNIFICATION_LIMITS.max, Math.max(DOCK_MAGNIFICATION_LIMITS.min, factor)) : DOCK_MAGNIFICATION_LIMITS.default;

/** Every live tile the dock can show (`TILE_IDS` in `src/dock/model.ts`), with the name the dock gives it. */
export const DOCK_TILE_NAMES = {
  clock: "Clock",
  analog: "Analog clock",
  flip: "Flip clock",
  world: "World clock",
  agenda: "Today",
  meeting: "Next meeting",
  progress: "Progress",
  sun: "Sun",
  focus: "Focus",
  stopwatch: "Stopwatch",
  reminders: "Reminders",
  hydration: "Water",
  notes: "Notes",
  media: "Now playing",
  audio: "Sound",
  mic: "Microphone",
  memo: "Voice memo",
  system: "System",
  cpu: "Processor",
  battery: "Battery",
  network: "Network",
  wind: "Wind",
  toggles: "Quick settings",
  contacts: "Contacts",
  colour: "Colour picker",
  convert: "Converter",
  currency: "Currency",
  emoji: "Emoji",
  search: "Web search",
  history: "History",
} as const;
export type DockTileId = keyof typeof DOCK_TILE_NAMES;
export const DOCK_TILE_IDS = Object.keys(DOCK_TILE_NAMES) as DockTileId[];

/** Names of the built-in stacks (`BUILTIN_NAMES` in `src/dock/strings.ts`); the user's own stacks are "Stack". */
const STACK_NAMES: Readonly<Record<string, string>> = {
  productivity: "Productivity",
  communication: "Communication",
  development: "Development",
  ai: "AI",
  creative: "Creative",
  browsers: "Browsers",
  media: "Media",
  games: "Games",
  utilities: "Utilities",
  system: "System",
  other: "Other",
};
const CUSTOM_STACK_NAME = "Stack";

export const tileName = (id: string): string => (DOCK_TILE_NAMES as Readonly<Record<string, string>>)[id] ?? id;

/** What a pinned item is called: the app's name from the dock's scan, or its stack's name. */
export function pinnedName(item: PinnedItem, apps: readonly DockAppName[]): string {
  if (item.kind === "stack") return `${STACK_NAMES[item.category] ?? CUSTOM_STACK_NAME} stack`;
  return apps.find((a) => a.id === item.id)?.name ?? item.id;
}

export const pinnedKey = (item: PinnedItem): string => (item.kind === "app" ? `app:${item.id}` : `stack:${item.category}`);

/** The list with the entry at `from` moved by `by` places, or the same list when it cannot move. */
export function moveBy<T>(list: readonly T[], from: number, by: number): readonly T[] {
  const to = from + by;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || by === 0) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export const removeAt = <T>(list: readonly T[], index: number): readonly T[] => list.filter((_, i) => i !== index);

/** Tiles not on the dock yet, in catalogue order. */
export const tilesNotOnDock = (onDock: readonly string[]): readonly DockTileId[] => DOCK_TILE_IDS.filter((id) => !onDock.includes(id));

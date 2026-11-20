/**
 * The dock's settings as Settings edits them. Mirrors `DockSettings` in the dock contract
 * (`src-tauri/dock/src/protocol.rs`, `src/dock/protocol.ts` on the dock branch) field for field, and the
 * dock's own limits and themes, so a value chosen here is one the dock draws exactly as chosen.
 */

export type DockEdge = "bottom" | "top" | "left" | "right";

export type PinnedItem = { readonly kind: "app"; readonly id: string } | { readonly kind: "stack"; readonly category: string };

export interface DockSettings {
  readonly schema: 1;
  /** Owned by the "Use the Windows taskbar" switch at the end of Settings; never edited here. */
  readonly enabled: boolean;
  readonly replaceTaskbar: boolean;
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

export const DOCK_EDGES: readonly DockEdge[] = ["bottom", "top", "left", "right"];

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
  autoHide: false,
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

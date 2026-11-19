import type { JsonObject } from "./json";

/** Each persisted document carries its own schema number; they evolve independently. */
export const SETTINGS_SCHEMA = 1;
export const LAYOUT_SCHEMA = 2;
export const THEME_SCHEMA = 1;
export const BACKUP_SCHEMA = 1;

/** Stable id of a display, as reported by the core. A plain browser has exactly one: "primary". */
export type MonitorId = string;
export const PRIMARY_MONITOR: MonitorId = "primary";

// ---------------------------------------------------------------- layout

export interface Placement {
  readonly id: string;
  /** Widget kind, resolved through the widget catalog. Unknown kinds are kept, never dropped. */
  readonly kind: string;
  /** Id of one of the widget's declared sizes. */
  readonly size: string;
  /** Top-left position in grid cells. */
  readonly x: number;
  readonly y: number;
  readonly config: JsonObject;
}

export interface MonitorLayout {
  readonly placements: readonly Placement[];
}

/** One file per profile: `layouts/<profileId>.json`. */
export interface LayoutDoc {
  readonly schema: typeof LAYOUT_SCHEMA;
  readonly profileId: string;
  readonly monitors: Readonly<Record<MonitorId, MonitorLayout>>;
}

// -------------------------------------------------------------- settings

export type CollisionMode = "push" | "swap";
export type MotionPreference = "system" | "full" | "reduced";
export type ThemeMode = "fixed" | "system" | "schedule";
export type UiFont = "sans" | "mono";

export interface ProfileMeta {
  readonly id: string;
  readonly name: string;
  /** Built-in profiles can be reset but not deleted. */
  readonly builtin: boolean;
}

export interface ThemeSelection {
  readonly mode: ThemeMode;
  /** Used when mode is "fixed". */
  readonly fixedId: string;
  /** Used when mode is "system" or "schedule". */
  readonly lightId: string;
  readonly darkId: string;
  /** "HH:MM" local time at which the light/dark theme takes over (schedule mode). */
  readonly lightFrom: string;
  readonly darkFrom: string;
}

export interface AppearanceSettings {
  /** Card corner radius in px; null follows the theme's default. */
  readonly cornerRadius: number | null;
  readonly font: UiFont;
  readonly motion: MotionPreference;
  /** Animation speed multiplier, 1 = default. */
  readonly motionSpeed: number;
}

export interface LayoutSettings {
  readonly collision: CollisionMode;
  readonly guides: boolean;
  /** Lock mode: edit mode opens, but nothing can be moved, resized, added or removed. */
  readonly locked: boolean;
  /** Space between widgets in px. */
  readonly gap: number;
  /** Safe margin between widgets and the screen edge in px. */
  readonly edgeMargin: number;
}

export type ShortcutAction = "toggleEditMode" | "openSettings" | "nextProfile";

export interface DisplayOverride {
  /** Per-display safe margin in px; null uses the global margin. */
  readonly edgeMargin: number | null;
}

export interface AppSettings {
  readonly schema: typeof SETTINGS_SCHEMA;
  readonly activeProfileId: string;
  readonly profiles: readonly ProfileMeta[];
  readonly theme: ThemeSelection;
  readonly appearance: AppearanceSettings;
  readonly layout: LayoutSettings;
  readonly displays: Readonly<Record<MonitorId, DisplayOverride>>;
  readonly shortcuts: Readonly<Record<ShortcutAction, string>>;
}

// ---------------------------------------------------------- widget meta

export interface WidgetSize {
  readonly id: string;
  readonly label: string;
  /** Footprint in grid cells. */
  readonly w: number;
  readonly h: number;
}

/** Generated settings form field; the same shape the widget manifest's settingsSchema compiles to. */
export type ConfigField =
  | { readonly type: "toggle"; readonly key: string; readonly label: string }
  | {
      readonly type: "choice";
      readonly key: string;
      readonly label: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
    }
  | {
      readonly type: "range";
      readonly key: string;
      readonly label: string;
      readonly min: number;
      readonly max: number;
      readonly step: number;
      readonly unit?: string;
    };

/** Pure-data description of a widget kind: everything layout and Settings need without rendering it. */
export interface WidgetMeta {
  readonly kind: string;
  readonly name: string;
  readonly description: string;
  readonly sizes: readonly WidgetSize[];
  readonly defaultSize: string;
  readonly defaultConfig: JsonObject;
  readonly fields: readonly ConfigField[];
}

export interface WidgetCatalogMeta {
  list(): readonly WidgetMeta[];
  get(kind: string): WidgetMeta | undefined;
}

export interface Cell {
  readonly x: number;
  readonly y: number;
}

export interface Rect extends Cell {
  readonly w: number;
  readonly h: number;
}

/** Visible grid extent in cells. */
export interface Bounds {
  readonly cols: number;
  readonly rows: number;
}

import type { ConfigSchema } from "../../widgets/configSchema";
import type { SizeSpec } from "../../widgets/sizes";
import type { JsonObject } from "./json";

/** Each persisted document carries its own schema number; they evolve independently. */
export const SETTINGS_SCHEMA = 1;
export const LAYOUT_SCHEMA = 3;
export const THEME_SCHEMA = 1;
export const BACKUP_SCHEMA = 1;

/** Stable id of a display, as reported by the core. A plain browser has exactly one: "primary". */
export type MonitorId = string;
export const PRIMARY_MONITOR: MonitorId = "primary";

// ---------------------------------------------------------------- layout

export interface Placement {
  readonly id: string;
  /** Widget id, resolved through the registry. Ids this build does not know are kept, never dropped. */
  readonly widget: string;
  /** Id of one of the widget's declared sizes; anything else renders at the widget's default size. */
  readonly size: string;
  /** Top-left position in grid cells, in steps of 1 / POSITION_STEPS: widgets are placed freely. */
  readonly x: number;
  readonly y: number;
  /** Only what the user changed; fields not listed here follow the widget's defaults. */
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

// -------------------------------------------------------------- catalog

/**
 * What layout and Settings need to know about a widget, without rendering it. A registry
 * `WidgetDefinition` satisfies this shape, so the app passes the registry in and tests pass a small fake.
 */
export interface WidgetInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  /** Footprints in cells. The first is the default size. */
  readonly sizes: readonly SizeSpec[];
  readonly settingsSchema: ConfigSchema;
}

export interface WidgetCatalog {
  list(): readonly WidgetInfo[];
  get(id: string): WidgetInfo | undefined;
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

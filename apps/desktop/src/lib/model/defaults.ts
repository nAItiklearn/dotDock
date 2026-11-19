import {
  LAYOUT_SCHEMA,
  PRIMARY_MONITOR,
  SETTINGS_SCHEMA,
  type AppSettings,
  type LayoutDoc,
  type Placement,
  type ProfileMeta,
  type ShortcutAction,
} from "./types";

export const BUILTIN_PROFILES: readonly ProfileMeta[] = [
  { id: "work", name: "Work", builtin: true },
  { id: "focus", name: "Focus", builtin: true },
  { id: "minimal", name: "Minimal", builtin: true },
];

export const DEFAULT_SHORTCUTS: Readonly<Record<ShortcutAction, string>> = {
  toggleEditMode: "Ctrl+Alt+E",
  openSettings: "Ctrl+Alt+S",
  nextProfile: "Ctrl+Alt+P",
};

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = ["toggleEditMode", "openSettings", "nextProfile"];

/** Bounds the editors enforce; the sanitizers clamp to the same numbers. */
export const LIMITS = {
  gap: { min: 8, max: 20, step: 2 },
  edgeMargin: { min: 8, max: 96, step: 4 },
  cornerRadius: { min: 0, max: 44, step: 2 },
  motionSpeed: { min: 0.5, max: 2, step: 0.25 },
  profileNameLength: 32,
  maxProfiles: 12,
  themeNameLength: 40,
  maxCustomThemes: 24,
} as const;

export const DEFAULT_SETTINGS: AppSettings = {
  schema: SETTINGS_SCHEMA,
  activeProfileId: "work",
  profiles: BUILTIN_PROFILES,
  theme: {
    mode: "fixed",
    fixedId: "obsidian",
    lightId: "paper",
    darkId: "obsidian",
    lightFrom: "07:00",
    darkFrom: "19:00",
  },
  appearance: { cornerRadius: null, font: "sans", motion: "system", motionSpeed: 1 },
  layout: { collision: "push", guides: true, locked: false, gap: 12, edgeMargin: 28 },
  displays: {},
  shortcuts: DEFAULT_SHORTCUTS,
};

function p(id: string, widget: string, size: string, x: number, y: number, config: Placement["config"] = {}): Placement {
  return { id, widget, size, x, y, config };
}

/**
 * Placements of the built-in profiles, by registry widget id and size. The Work layout is modelled on the
 * reference desktop (a stacked clock top-left, cards beside it) and stays inside 12 columns by 6 rows,
 * so it fits a 1280x720 screen without being rearranged. Config is empty wherever the defaults are wanted.
 */
const BUILTIN_PLACEMENTS: Readonly<Record<string, readonly Placement[]>> = {
  work: [
    p("clock-1", "clock", "l", 0, 0),
    p("calendar-1", "calendar", "m", 4, 0),
    p("date-1", "date", "s", 7, 0),
    p("battery-1", "battery", "m", 9, 0),
    p("weather-1", "weather", "l", 4, 2),
    p("system-1", "system", "m", 8, 2),
    p("system-2", "system", "m", 10, 2, { metric: "disk" }),
    p("todo-1", "todo", "m", 0, 4),
    p("music-1", "music", "m", 4, 4),
  ],
  focus: [
    p("clock-1", "clock", "m", 0, 0),
    p("timer-1", "timer", "m", 0, 2),
    p("todo-1", "todo", "l", 4, 0),
    p("music-1", "music", "s", 0, 4),
  ],
  minimal: [p("clock-1", "clock", "m", 0, 0, { matrixStyle: "dots" })],
};

export function defaultLayoutDoc(profileId: string): LayoutDoc {
  const placements = BUILTIN_PLACEMENTS[profileId] ?? [];
  return {
    schema: LAYOUT_SCHEMA,
    profileId,
    monitors: placements.length > 0 ? { [PRIMARY_MONITOR]: { placements } } : {},
  };
}

export function hasBuiltinLayout(profileId: string): boolean {
  return profileId in BUILTIN_PLACEMENTS;
}

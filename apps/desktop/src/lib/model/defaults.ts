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

function p(
  id: string,
  kind: string,
  size: string,
  x: number,
  y: number,
  config: Placement["config"] = {},
): Placement {
  return { id, kind, size, x, y, config };
}

const CLOCK_CONFIG = { matrixStyle: "blocks", hour24: true, showSeconds: false, blinkColon: false } as const;

/** Placements of the built-in profiles, modelled on the reference desktop: clock top-left, widgets below. */
const BUILTIN_PLACEMENTS: Readonly<Record<string, readonly Placement[]>> = {
  work: [
    p("clock-1", "clock", "m", 0, 0, CLOCK_CONFIG),
    p("battery-ring-1", "battery-ring", "m", 0, 2),
    p("calendar-1", "calendar", "m", 2, 2),
    p("date-circle-1", "date-circle", "m", 5, 2),
    p("ram-1", "ram", "m", 0, 4),
    p("disk-1", "disk", "m", 2, 4),
    p("weather-1", "weather", "m", 4, 4),
    p("battery-grid-1", "battery-grid", "m", 4, 5),
  ],
  focus: [
    p("clock-1", "clock", "m", 0, 0, CLOCK_CONFIG),
    p("calendar-1", "calendar", "m", 0, 2),
    p("battery-ring-1", "battery-ring", "m", 3, 2),
  ],
  minimal: [p("clock-1", "clock", "s", 0, 0, { ...CLOCK_CONFIG, matrixStyle: "dots" })],
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

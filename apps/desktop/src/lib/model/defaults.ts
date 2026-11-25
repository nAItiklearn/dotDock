import {
  LAYOUT_SCHEMA,
  PRIMARY_MONITOR,
  SETTINGS_SCHEMA,
  WALLPAPER_THEME_ID,
  type AppSettings,
  type Bounds,
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
    // The theme made from the user's own wallpaper (owner, 2026-11-22): derived once on the first start, then it
    // follows each new wallpaper. Until the picture is read, the Obsidian fallback shows.
    fixedId: WALLPAPER_THEME_ID,
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

/**
 * The smallest cell grid a built-in layout has to fit, so a new install never has a widget pushed off
 * the screen and relocated. The grid cell is a fixed CSS pixel token, so the cell count follows the
 * viewport the webview gets, which is the panel divided by the Windows scaling: seven rows is a 660 px
 * tall viewport, met by every 1080p and 1440p screen at 100, 125 and 150 %, and by a 1366 x 768 laptop
 * at the 100 % Windows recommends for it. Smaller than this the built-in layout sheds what cannot fit
 * from the end of each column; it never reflows into a different arrangement.
 */
export const MIN_SUPPORTED_BOUNDS: Bounds = { cols: 7, rows: 7 };

function p(id: string, widget: string, size: string, x: number, y: number, config: Placement["config"] = {}): Placement {
  return { id, widget, size, x, y, config };
}

/**
 * Placements of the built-in profiles, by registry widget id and size. The Work layout is the owner's
 * own home screen as two columns (B5, `docs/BUGS_1_0_3.md`): on the left the big clock with the weekday
 * under it, the now-playing card and the photo frame; beside it the date pill, the battery ring, the
 * timer dial and the RAM dots.
 *
 * Every position is a whole cell. The owner's captured layout (`docs/defaults-from-owner/home-storage.json`)
 * carried a 1/32-cell jitter from free placement, which D-044 believed it had snapped to whole rows and had
 * not: `system` sat at row 6.3125 and `date` at 6.53125, so on any viewport shorter than eight rows they
 * were clamped into an occupied cell and then relocated to the "nearest free spot" - the scattered default
 * users reported. Whole cells, and a footprint inside `MIN_SUPPORTED_BOUNDS`, are what keep the arrangement
 * identical on every screen: the cell is a fixed CSS pixel token, so a larger screen only adds empty cells
 * around it. The photo frame starts empty: the picture is the user's to choose. Config is empty wherever
 * the widget's own defaults are wanted.
 */
const BUILTIN_PLACEMENTS: Readonly<Record<string, readonly Placement[]>> = {
  work: [
    p("clock-1", "clock", "m", 0, 0),
    p("music-1", "music", "m", 0, 2),
    p("photo-1", "photo", "s", 0, 4, { radius: 12 }),
    p("date-1", "date", "m", 4, 0),
    p("battery-1", "battery", "m", 4, 1),
    p("timer-1", "timer", "s", 4, 3),
    p("system-1", "system", "m", 4, 5),
  ],
  focus: [
    p("clock-1", "clock", "m", 0, 0),
    p("timer-1", "timer", "m", 0, 2),
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

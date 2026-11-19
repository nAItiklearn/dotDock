import { applyTheme, BUILTIN_THEMES, OBSIDIAN, type Theme } from "../../design-system/themes";
import type { AppSettings, MonitorId, ThemeSelection } from "../model/types";
import { toRuntimeTheme, type ThemeDoc } from "./schema";

const MINUTES_PER_DAY = 24 * 60;

function minutesOf(time: string): number {
  const [h = "0", m = "0"] = time.split(":");
  return Number(h) * 60 + Number(m);
}

/** Which theme is showing right now, given the user's rule, the clock and the OS preference. */
export function resolveThemeId(sel: ThemeSelection, now: Date, systemPrefersDark: boolean): string {
  if (sel.mode === "fixed") return sel.fixedId;
  if (sel.mode === "system") return systemPrefersDark ? sel.darkId : sel.lightId;
  const t = now.getHours() * 60 + now.getMinutes();
  const lightStart = minutesOf(sel.lightFrom);
  const lightSpan = (minutesOf(sel.darkFrom) - lightStart + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const sinceLight = (t - lightStart + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return sinceLight < lightSpan ? sel.lightId : sel.darkId;
}

/** Milliseconds until the schedule next flips, or null when the theme does not depend on time. */
export function msUntilNextSwitch(sel: ThemeSelection, now: Date): number | null {
  if (sel.mode !== "schedule") return null;
  const t = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
  const day = MINUTES_PER_DAY * 60;
  const deltas = [sel.lightFrom, sel.darkFrom].map((time) => {
    const at = minutesOf(time) * 60;
    const delta = (at - t + day) % day;
    return delta === 0 ? day : delta;
  });
  return Math.min(...deltas) * 1000;
}

export function allThemes(custom: readonly ThemeDoc[]): readonly Theme[] {
  return [...BUILTIN_THEMES, ...custom.map(toRuntimeTheme)];
}

export function findTheme(id: string, custom: readonly ThemeDoc[]): Theme {
  return allThemes(custom).find((t) => t.id === id) ?? OBSIDIAN;
}

/** Margin to the screen edge for one display: its own override, else the global value. */
export function effectiveEdgeMargin(settings: AppSettings, monitorId: MonitorId): number {
  return settings.displays[monitorId]?.edgeMargin ?? settings.layout.edgeMargin;
}

const BASE_DURATIONS_MS = { "--dur-fast": 140, "--dur-med": 260, "--dur-slow": 520 } as const;
/** Card radius steps relative to the large radius, matching the ratios in tokens.css. */
const RADIUS_MD_RATIO = 20 / 28;
const RADIUS_SM_RATIO = 12 / 28;

export interface AppearanceEnvironment {
  readonly monitorId: MonitorId;
  readonly osReducesMotion: boolean;
}

/**
 * Writes every user-controlled token onto the root. Nothing here is cached: calling it again with
 * the same input is a no-op visually, so it is safe to run on every settings change.
 */
export function applyAppearance(
  theme: Theme,
  settings: AppSettings,
  env: AppearanceEnvironment,
  root: HTMLElement = document.documentElement,
): void {
  applyTheme(theme, root);
  const style = root.style;
  const { appearance, layout } = settings;

  const radius = appearance.cornerRadius;
  if (radius === null) {
    style.removeProperty("--radius-lg");
    style.removeProperty("--radius-md");
    style.removeProperty("--radius-sm");
  } else {
    style.setProperty("--radius-lg", `${radius}px`);
    style.setProperty("--radius-md", `${Math.round(radius * RADIUS_MD_RATIO)}px`);
    style.setProperty("--radius-sm", `${Math.round(radius * RADIUS_SM_RATIO)}px`);
  }

  style.setProperty("--gap", `${layout.gap}px`);
  style.setProperty("--edge", `${effectiveEdgeMargin(settings, env.monitorId)}px`);

  const still = appearance.motion === "reduced" || (appearance.motion === "system" && env.osReducesMotion);
  for (const [name, base] of Object.entries(BASE_DURATIONS_MS)) {
    style.setProperty(name, still ? "0ms" : `${Math.round(base / appearance.motionSpeed)}ms`);
  }

  style.setProperty("--font-ui", appearance.font === "mono" ? "var(--font-mono)" : '"Geist", system-ui, sans-serif');
}

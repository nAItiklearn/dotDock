import { AURUM, OBSIDIAN, PAPER, type Theme } from "../design-system/themes";
import type { Effects } from "./effects";
import type { DockBackdrop } from "./protocol";

/**
 * How the dock bar is drawn. The first two let what is behind the dock show through; the rest are solid.
 * - glass: a frosted, tinted plate (DOCK_SPEC 4b) drawn by CSS. A native backdrop behind the window was tried and
 *   removed: DWM drew it over the whole monitor-sized window (D-034).
 * - glass-lite: the same bar, semi-opaque and unblurred. Chosen automatically when glass cannot be done.
 * - obsidian, paper, aurum: solid, in the home screen's own palettes whatever the app theme is.
 * - minimal: icons only, no bar.
 */
export const DOCK_THEMES = ["glass", "glass-lite", "obsidian", "paper", "aurum", "minimal"] as const;
export type DockThemeId = (typeof DOCK_THEMES)[number];

export const DEFAULT_THEME: DockThemeId = "glass";
export const THEME_STORAGE_KEY = "dotdock.dock.theme";

export const isDockTheme = (value: string | null): value is DockThemeId => value !== null && (DOCK_THEMES as readonly string[]).includes(value);

export type Backdrop = DockBackdrop;

/** Until the core says otherwise there is no blur to rely on and no tone to match. */
export const DEFAULT_BACKDROP: Backdrop = { available: false, tone: null, saver: false };

/** The theme actually drawn: glass steps down to glass-lite whenever blur is off, unavailable or too costly. */
export function resolveTheme(choice: DockThemeId, effects: Effects, backdrop: Backdrop): DockThemeId {
  if (choice !== "glass") return choice;
  return effects === "lite" || !backdrop.available || backdrop.saver ? "glass-lite" : "glass";
}

/** Themes whose bar lets the desktop show through, so its tone decides what is readable. */
export const isTranslucent = (theme: DockThemeId): boolean => theme === "glass" || theme === "glass-lite";

/**
 * The palette to put on the dock when it should not just inherit the app's theme, or null to inherit. The solid
 * themes carry their own palette. A translucent or minimal bar keeps the app's theme while that theme suits the
 * desktop behind it; over a light desktop with a dark theme (or the reverse) it takes the matching built-in one,
 * so labels and icons never sit dark on dark.
 */
export function paletteFor(theme: DockThemeId, backdropTone: Backdrop["tone"], appMode: Theme["mode"]): Theme | null {
  switch (theme) {
    case "obsidian":
      return OBSIDIAN;
    case "paper":
      return PAPER;
    case "aurum":
      return AURUM;
    default:
      if (backdropTone === null || backdropTone === (appMode === "light" ? "light" : "dark")) return null;
      return backdropTone === "light" ? PAPER : OBSIDIAN;
  }
}

export function readThemeChoice(): DockThemeId {
  const fromAddress = new URLSearchParams(location.search).get("dock-theme");
  if (isDockTheme(fromAddress)) return fromAddress;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isDockTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveThemeChoice(choice: DockThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Without storage the choice lasts until the window closes.
  }
}

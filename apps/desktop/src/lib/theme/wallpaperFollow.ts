import type { ThemeSelection } from "../model/types";
import type { SettingsStore } from "../state/settingsStore";
import { extractPalette, type PixelGrid, type WallpaperPalette } from "./palette";
import type { ThemeDoc } from "./schema";
import { applyWallpaperTheme } from "./wallpaperApply";
import { buildThemeDoc, suggestMode, themeFromPalette, themeNameFor, WALLPAPER_THEME_ID, type WallpaperMode } from "./wallpaperTheme";

/** The core's event when the user picked another Windows wallpaper (`wallpaper_host.rs`). */
export const EVENT_WALLPAPER_CHANGED = "wallpaper://changed";

/** Whether the theme in use is the one made from the wallpaper, in any slot. Only then does it follow a new one. */
export function followsWallpaper(selection: ThemeSelection): boolean {
  return selection.mode === "fixed"
    ? selection.fixedId === WALLPAPER_THEME_ID
    : selection.darkId === WALLPAPER_THEME_ID || selection.lightId === WALLPAPER_THEME_ID;
}

/**
 * The mode the theme from the wallpaper takes: in the fixed mode it matches the new picture; in the automatic
 * modes it keeps the light or dark slot it fills.
 */
export function followedMode(selection: ThemeSelection, palette: WallpaperPalette): WallpaperMode | null {
  if (!followsWallpaper(selection)) return null;
  if (selection.mode === "fixed") return suggestMode(palette);
  return selection.darkId === WALLPAPER_THEME_ID ? "dark" : "light";
}

/** The theme document re-derived from the new wallpaper's colours, or null when the theme does not follow it. */
export function followedTheme(selection: ThemeSelection, palette: WallpaperPalette): ThemeDoc | null {
  const mode = followedMode(selection, palette);
  if (mode === null) return null;
  return buildThemeDoc(themeFromPalette(palette, mode), mode, themeNameFor(null));
}

/**
 * Re-derives the palette from the wallpaper Windows now shows and puts it in use, when the user's theme is the one
 * made from the wallpaper. The picture is not even read for a theme the user chose by hand, which is never replaced.
 * Every change lands in one store update after the picture is read, so the dock and the widgets repaint together.
 */
export async function followWallpaper(
  store: SettingsStore,
  readImage: () => Promise<Blob>,
  sample: (image: Blob) => Promise<PixelGrid>,
): Promise<boolean> {
  if (!followsWallpaper(store.getState().settings.theme)) return false;
  const palette = extractPalette(await sample(await readImage()));
  if (!palette) return false;
  const doc = followedTheme(store.getState().settings.theme, palette);
  return doc !== null && applyWallpaperTheme(store, doc).ok;
}

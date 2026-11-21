import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { widgetCatalog } from "../../overlay/catalog";
import { DEFAULT_SETTINGS } from "../model/defaults";
import { createApp, type AppContext } from "../state/app";
import { MemoryBackend } from "../storage/backend";
import { extractPalette, type PixelGrid } from "./palette";
import { applyWallpaperTheme } from "./wallpaperApply";
import { followedTheme, followWallpaper, followsWallpaper } from "./wallpaperFollow";
import { buildThemeDoc, themeFromPalette, WALLPAPER_THEME_ID } from "./wallpaperTheme";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const EDGE = 8;

/** A picture of one colour, as the sampler hands it over. */
function grid(color: readonly [number, number, number]): PixelGrid {
  const data = new Uint8ClampedArray(EDGE * EDGE * 4);
  for (let p = 0; p < EDGE * EDGE; p++) data.set([...color, 255], p * 4);
  return { width: EDGE, height: EDGE, data };
}

const NIGHT_BLUE: readonly [number, number, number] = [20, 40, 120];
const SUNNY_YELLOW: readonly [number, number, number] = [250, 220, 90];

function palette(color: readonly [number, number, number]) {
  const found = extractPalette(grid(color));
  if (!found) throw new Error("no palette");
  return found;
}

async function boot(): Promise<AppContext> {
  const bus = { send: () => undefined, subscribe: () => () => undefined };
  const app = createApp({ catalog: widgetCatalog, backend: new MemoryBackend(), bus });
  await app.start();
  return app;
}

/** Puts the theme made from a first wallpaper in use, as Settings' "Use this theme" does. */
function useWallpaperTheme(app: AppContext, color: readonly [number, number, number]): void {
  const doc = buildThemeDoc(themeFromPalette(palette(color), "dark"), "dark", "My wallpaper");
  expect(applyWallpaperTheme(app.settings, doc).ok).toBe(true);
}

const readImage = () => Promise.resolve(new Blob());

describe("following the Windows wallpaper", () => {
  it("follows only while the theme in use is the one made from the wallpaper", () => {
    expect(followsWallpaper(DEFAULT_SETTINGS.theme)).toBe(false);
    expect(followsWallpaper({ ...DEFAULT_SETTINGS.theme, fixedId: WALLPAPER_THEME_ID })).toBe(true);
    expect(followsWallpaper({ ...DEFAULT_SETTINGS.theme, mode: "system", lightId: WALLPAPER_THEME_ID })).toBe(true);
    expect(followedTheme(DEFAULT_SETTINGS.theme, palette(NIGHT_BLUE))).toBeNull();
  });

  it("re-derives the palette from the new wallpaper and puts it in use in one update", async () => {
    const app = await boot();
    useWallpaperTheme(app, NIGHT_BLUE);
    const before = app.settings.getState().customThemes.find((t) => t.id === WALLPAPER_THEME_ID);
    const updates = vi.fn();
    const off = app.settings.subscribe(updates);

    const followed = await followWallpaper(app.settings, readImage, () => Promise.resolve(grid(SUNNY_YELLOW)));
    off();

    expect(followed).toBe(true);
    const after = app.settings.getState().customThemes.find((t) => t.id === WALLPAPER_THEME_ID);
    expect(after?.colors).not.toEqual(before?.colors);
    expect(after?.mode).toBe("light");
    expect(app.settings.getState().settings.theme.fixedId).toBe(WALLPAPER_THEME_ID);
    // Saving the theme and selecting it are two store writes made in the same task, so they paint in one frame.
    expect(updates.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("keeps the light or dark slot it fills in an automatic mode", () => {
    const system = { ...DEFAULT_SETTINGS.theme, mode: "system" as const, darkId: WALLPAPER_THEME_ID };
    expect(followedTheme(system, palette(SUNNY_YELLOW))?.mode).toBe("dark");
  });

  it("never replaces a theme the user chose by hand, and does not even read the picture for it", async () => {
    const app = await boot();
    const read = vi.fn(readImage);
    const before = app.settings.getState().settings.theme;
    expect(await followWallpaper(app.settings, read, () => Promise.resolve(grid(SUNNY_YELLOW)))).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(app.settings.getState().settings.theme).toEqual(before);
  });
});

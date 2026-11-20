import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { widgetCatalog } from "../../overlay/catalog";
import { DEFAULT_SETTINGS, LIMITS } from "../model/defaults";
import { createApp, type AppContext } from "../state/app";
import { MemoryBackend } from "../storage/backend";
import { extractPalette } from "./palette";
import { applyWallpaperTheme, selectTheme } from "./wallpaperApply";
import { buildThemeDoc, themeFromPalette, WALLPAPER_THEME_ID } from "./wallpaperTheme";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function boot(): Promise<AppContext> {
  const bus = { send: () => undefined, subscribe: () => () => undefined };
  const app = createApp({ catalog: widgetCatalog, backend: new MemoryBackend(), bus });
  await app.start();
  return app;
}

function themeFor(mode: "dark" | "light", name = "From my wallpaper", color: readonly [number, number, number] = [40, 90, 200]) {
  const data = new Uint8ClampedArray(64 * 4);
  for (let p = 0; p < 64; p++) data.set([...color, 255], p * 4);
  const palette = extractPalette({ width: 8, height: 8, data });
  if (!palette) throw new Error("no palette");
  return buildThemeDoc(themeFromPalette(palette, mode), mode, name);
}

const state = (app: AppContext) => app.settings.getState();

describe("selectTheme", () => {
  it("replaces the one theme in fixed mode", () => {
    expect(selectTheme(DEFAULT_SETTINGS.theme, { id: "x", mode: "light" }).fixedId).toBe("x");
  });

  it("fills only the matching slot in the automatic modes", () => {
    const system = { ...DEFAULT_SETTINGS.theme, mode: "system" as const };
    expect(selectTheme(system, { id: "x", mode: "light" })).toMatchObject({ lightId: "x", darkId: "obsidian" });
    expect(selectTheme(system, { id: "x", mode: "dark" })).toMatchObject({ lightId: "paper", darkId: "x" });
  });
});

describe("applyWallpaperTheme", () => {
  it("saves the theme and switches to it", async () => {
    const app = await boot();
    const result = applyWallpaperTheme(app.settings, themeFor("dark"));
    expect(result.ok).toBe(true);
    expect(state(app).customThemes.map((t) => t.id)).toEqual([WALLPAPER_THEME_ID]);
    expect(state(app).settings.theme.fixedId).toBe(WALLPAPER_THEME_ID);
  });

  it("undo removes the theme it added and puts the old choice back", async () => {
    const app = await boot();
    const result = applyWallpaperTheme(app.settings, themeFor("dark"));
    if (!result.ok) throw new Error(result.reason);
    result.undo();
    expect(state(app).customThemes).toEqual([]);
    expect(state(app).settings.theme).toEqual(DEFAULT_SETTINGS.theme);
  });

  it("replaces the previous wallpaper theme instead of piling up, and undo brings the earlier one back", async () => {
    const app = await boot();
    const first = themeFor("dark", "First", [200, 60, 60]);
    applyWallpaperTheme(app.settings, first);
    const second = applyWallpaperTheme(app.settings, themeFor("dark", "Second", [60, 200, 90]));
    if (!second.ok) throw new Error(second.reason);
    expect(state(app).customThemes).toHaveLength(1);
    expect(state(app).customThemes[0]?.name).toBe("Second");
    second.undo();
    expect(state(app).customThemes).toEqual([first]);
    expect(state(app).settings.theme.fixedId).toBe(WALLPAPER_THEME_ID);
  });

  it("restores the previous choice when the user was following Windows light and dark", async () => {
    const app = await boot();
    state(app).update((s) => ({ ...s, theme: { ...s.theme, mode: "system", lightId: "paper", darkId: "aurum" } }));
    const before = state(app).settings.theme;
    const result = applyWallpaperTheme(app.settings, themeFor("light"));
    if (!result.ok) throw new Error(result.reason);
    expect(state(app).settings.theme).toMatchObject({ mode: "system", lightId: WALLPAPER_THEME_ID, darkId: "aurum" });
    result.undo();
    expect(state(app).settings.theme).toEqual(before);
  });

  it("says so, and changes nothing, when there is no room for another custom theme", async () => {
    const app = await boot();
    for (let n = 0; n < LIMITS.maxCustomThemes; n++) {
      const filler = { ...themeFor("dark", `Filler ${n}`), id: `custom-filler-${n}` };
      state(app).saveTheme(filler);
    }
    const before = state(app).settings.theme;
    const result = applyWallpaperTheme(app.settings, themeFor("dark"));
    expect(result.ok).toBe(false);
    expect(state(app).customThemes).toHaveLength(LIMITS.maxCustomThemes);
    expect(state(app).settings.theme).toEqual(before);
  });
});

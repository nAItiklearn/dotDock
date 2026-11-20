import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { widgetCatalog } from "../../overlay/catalog";
import { DEFAULT_SETTINGS, LIMITS } from "../model/defaults";
import { createApp, type AppContext } from "../state/app";
import { MemoryBackend } from "../storage/backend";
import { extractPalette } from "./palette";
import { applyWallpaperTheme, selectTheme } from "./wallpaperApply";
import { auditAa, buildThemeDoc, suggestMode, themeFromPalette, WALLPAPER_THEME_ID } from "./wallpaperTheme";

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

/** A theme from one of the shipped wallpapers, sampled as the webview samples it (see wallpaperFixtures.test.ts). */
function themeFromWallpaper(name: string) {
  const bytes = readFileSync(join(__dirname, "fixtures", "wallpapers", `${name}.rgb`));
  const width = bytes.readUInt16LE(0);
  const height = bytes.readUInt16LE(2);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([bytes[4 + i * 3] ?? 0, bytes[5 + i * 3] ?? 0, bytes[6 + i * 3] ?? 0, 255], i * 4);
  const palette = extractPalette({ width, height, data });
  if (!palette) throw new Error(`${name} has no pixels`);
  const mode = suggestMode(palette);
  return { palette, doc: buildThemeDoc(themeFromPalette(palette, mode), mode, name) };
}

describe("theme from real wallpapers: preview, apply, undo", () => {
  const THREE = ["meadow-dots-dark", "paper-ring-light", "soft-mono-dark"] as const;

  it("previewing changes nothing: every accent and mode is built and audited without touching the settings", async () => {
    const app = await boot();
    const before = structuredClone({ settings: state(app).settings, customThemes: state(app).customThemes });
    for (const name of THREE) {
      const { palette } = themeFromWallpaper(name);
      for (const mode of ["dark", "light"] as const) {
        for (const accent of palette.accents.length > 0 ? palette.accents : [undefined]) {
          auditAa(buildThemeDoc(themeFromPalette(palette, mode, accent), mode, name).colors);
        }
      }
    }
    expect({ settings: state(app).settings, customThemes: state(app).customThemes }).toEqual(before);
  });

  it("applies three wallpapers in a row and undoes back to exactly where it started", async () => {
    const app = await boot();
    const initial = structuredClone({ settings: state(app).settings, customThemes: state(app).customThemes });
    const undos: (() => void)[] = [];
    for (const name of THREE) {
      const { doc } = themeFromWallpaper(name);
      const result = applyWallpaperTheme(app.settings, doc);
      if (!result.ok) throw new Error(result.reason);
      expect(state(app).customThemes.find((t) => t.id === WALLPAPER_THEME_ID)?.name).toBe(name);
      expect(state(app).settings.theme.fixedId).toBe(WALLPAPER_THEME_ID);
      undos.push(result.undo);
    }
    expect(state(app).customThemes).toHaveLength(1);
    // Each undo brings back the wallpaper theme before it, in reverse.
    undos.pop()?.();
    expect(state(app).customThemes[0]?.name).toBe(THREE[1]);
    undos.pop()?.();
    expect(state(app).customThemes[0]?.name).toBe(THREE[0]);
    undos.pop()?.();
    expect({ settings: state(app).settings, customThemes: state(app).customThemes }).toEqual(initial);
  });

  it("keeps what it saved after a restart, and so does an undo", async () => {
    const backend = new MemoryBackend();
    const bus = { send: () => undefined, subscribe: () => () => undefined };
    const first = createApp({ catalog: widgetCatalog, backend, bus });
    await first.start();
    const result = applyWallpaperTheme(first.settings, themeFromWallpaper("meadow-dots-dark").doc);
    if (!result.ok) throw new Error(result.reason);
    await vi.runAllTimersAsync();
    const second = createApp({ catalog: widgetCatalog, backend, bus });
    await second.start();
    expect(second.settings.getState().settings.theme.fixedId).toBe(WALLPAPER_THEME_ID);
    result.undo();
    await vi.runAllTimersAsync();
    const third = createApp({ catalog: widgetCatalog, backend, bus });
    await third.start();
    expect(third.settings.getState().settings.theme).toEqual(DEFAULT_SETTINGS.theme);
    expect(third.settings.getState().customThemes).toEqual([]);
  });
});

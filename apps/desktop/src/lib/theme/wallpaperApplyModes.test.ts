import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { widgetCatalog } from "../../overlay/catalog";
import { createApp } from "../state/app";
import { MemoryBackend } from "../storage/backend";
import { extractPalette } from "./palette";
import { applyWallpaperTheme } from "./wallpaperApply";
import { buildThemeDoc, suggestMode, themeFromPalette } from "./wallpaperTheme";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function doc(name: string) {
  const bytes = readFileSync(join(__dirname, "fixtures", "wallpapers", `${name}.rgb`));
  const w = bytes.readUInt16LE(0), h = bytes.readUInt16LE(2);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([bytes[4 + i * 3] ?? 0, bytes[5 + i * 3] ?? 0, bytes[6 + i * 3] ?? 0, 255], i * 4);
  const p = extractPalette({ width: w, height: h, data });
  if (!p) throw new Error(`${name} has no pixels`);
  const m = suggestMode(p);
  return buildThemeDoc(themeFromPalette(p, m), m, name);
}
describe("undo after a second wallpaper theme, in every theme mode", () => {
  for (const mode of ["fixed", "system", "schedule"] as const) {
    it(`puts back the first wallpaper theme and the choice exactly, in ${mode} mode`, async () => {
      const app = createApp({ catalog: widgetCatalog, backend: new MemoryBackend(), bus: { send: () => undefined, subscribe: () => () => undefined } });
      await app.start();
      const s = () => app.settings.getState();
      s().update((x) => ({ ...x, theme: { ...x.theme, mode } }));
      const r0 = applyWallpaperTheme(app.settings, doc("meadow-dots-dark"));
      if (!r0.ok) throw new Error(r0.reason);
      const snap = structuredClone({ t: s().settings.theme, c: s().customThemes });
      const r1 = applyWallpaperTheme(app.settings, doc("paper-ring-light"));
      if (!r1.ok) throw new Error(r1.reason);
      r1.undo();
      expect({ t: s().settings.theme, c: s().customThemes }).toEqual(snap);
    });
  }
});

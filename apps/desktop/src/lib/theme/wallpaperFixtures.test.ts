import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractPalette, type PixelGrid, type WallpaperPalette } from "./palette";
import { SAMPLE_EDGE } from "./imageSample";
import { auditAa, suggestMode, themeFromPalette, type WallpaperMode } from "./wallpaperTheme";

/**
 * "Theme from your wallpaper" on real pictures: every wallpaper dotDock ships, shrunk to the grid the
 * webview hands the palette (tools/theme-fixtures/sample-wallpapers.ps1). They span dark and light,
 * busy (halftone, topography, the meadow), smooth (orbs, liquid gold) and monochrome (soft-mono, louver
 * silver). Pictures that are not ours (Windows' own, the owner's references) are sampled into the
 * never-committed fixtures-local folder and checked the same way when it exists.
 */

const COMMITTED = join(__dirname, "fixtures", "wallpapers");
const LOCAL = join(__dirname, "fixtures-local");
const MODES: readonly WallpaperMode[] = ["dark", "light"];
/** At least this many committed pictures: 16 wallpapers in a dark and a light variant. */
const SHIPPED_PICTURES = 32;

/** `<name>.rgb`: uint16 width, uint16 height (little-endian), then RGB bytes row by row. */
function readGrid(file: string): PixelGrid {
  const bytes = readFileSync(file);
  const width = bytes.readUInt16LE(0);
  const height = bytes.readUInt16LE(2);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = bytes[4 + i * 3] ?? 0;
    data[i * 4 + 1] = bytes[5 + i * 3] ?? 0;
    data[i * 4 + 2] = bytes[6 + i * 3] ?? 0;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function pictures(dir: string): readonly (readonly [string, WallpaperPalette])[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".rgb"))
    .sort()
    .map((name) => {
      const palette = extractPalette(readGrid(join(dir, name)));
      if (!palette) throw new Error(`${name} has no pixels`);
      return [name, palette] as const;
    });
}

/** Every failing pair of every theme a picture can give: both modes, every accent the user can pick. */
function failures(name: string, palette: WallpaperPalette): readonly string[] {
  const out: string[] = [];
  const accents = palette.accents.length > 0 ? palette.accents : [undefined];
  for (const mode of MODES) {
    accents.forEach((accent, index) => {
      for (const check of auditAa(themeFromPalette(palette, mode, accent).colors)) {
        if (!check.pass) out.push(`${name} ${mode} accent ${index}: ${check.label} ${check.ratio.toFixed(2)}`);
      }
    });
  }
  return out;
}

const shipped = pictures(COMMITTED);

describe("theme from real wallpapers", () => {
  it("samples every shipped wallpaper at the grid size the webview uses", () => {
    expect(shipped.length).toBeGreaterThanOrEqual(SHIPPED_PICTURES);
    for (const name of readdirSync(COMMITTED)) {
      const grid = readGrid(join(COMMITTED, name));
      expect(Math.max(grid.width, grid.height), name).toBe(SAMPLE_EDGE);
    }
  });

  it("meets WCAG AA on every text and surface pair, for every accent and both modes", () => {
    expect(shipped.flatMap(([name, palette]) => failures(name, palette))).toEqual([]);
  });

  it("covers dark, light, colourful and colourless pictures", () => {
    const modes = new Set(shipped.map(([, palette]) => suggestMode(palette)));
    expect(modes).toEqual(new Set(["dark", "light"]));
    expect(shipped.some(([, palette]) => palette.accents.length === 0)).toBe(true);
    expect(shipped.some(([, palette]) => palette.accents.length >= 2)).toBe(true);
  });

  it("reads each variant's own light or dark", () => {
    for (const [name, palette] of shipped) {
      const variant = name.includes("-light") ? "light" : "dark";
      expect(suggestMode(palette), name).toBe(variant);
    }
  });

  it("takes the meadow's green for the Wind Meadow wallpaper", () => {
    const meadow = shipped.find(([name]) => name === "meadow-dots-dark.rgb");
    expect(meadow).toBeDefined();
    const backdrop = meadow?.[1].backdrop.lch;
    // Green sits around 140 degrees of OKLCH hue.
    expect(backdrop && backdrop.h > 100 && backdrop.h < 180).toBe(true);
  });

  const local = pictures(LOCAL);
  it.skipIf(local.length === 0)(`meets AA on the ${local.length} local pictures that are not ours as well`, () => {
    expect(local.flatMap(([name, palette]) => failures(name, palette))).toEqual([]);
  });
});

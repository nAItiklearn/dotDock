import { describe, expect, it } from "vitest";
import { OBSIDIAN, PAPER } from "../../design-system/themes";
import { contrastRatio, formatColor, parseColor } from "./color";
import { rgbToOklch } from "./oklch";
import { extractPalette, hueDistance, type PixelGrid, type WallpaperPalette } from "./palette";
import { THEME_ROLES, validateThemeDoc } from "./schema";
import { auditAa, buildThemeDoc, suggestMode, themeFromPalette, WALLPAPER_THEME_ID, type WallpaperMode } from "./wallpaperTheme";

type Triplet = readonly [number, number, number];

function picture(width: number, parts: readonly { readonly color: Triplet; readonly count: number }[]): PixelGrid {
  const pixels = parts.reduce((sum, p) => sum + p.count, 0);
  const data = new Uint8ClampedArray(pixels * 4);
  let at = 0;
  for (const { color, count } of parts) {
    for (let n = 0; n < count; n++) {
      data.set([...color, 255], at);
      at += 4;
    }
  }
  return { width, height: pixels / width, data };
}

const paletteOf = (grid: PixelGrid): WallpaperPalette => {
  const palette = extractPalette(grid);
  if (!palette) throw new Error("test picture has no pixels");
  return palette;
};
const flat = (color: Triplet): WallpaperPalette => paletteOf(picture(8, [{ color, count: 64 }]));

const MODES: readonly WallpaperMode[] = ["dark", "light"];

/** HSL to 8-bit RGB, so the sweeps below can walk colours by hue, saturation and lightness. */
function hsl(h: number, s: number, l: number): Triplet {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): number => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [channel(0), channel(8), channel(4)];
}

const HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330] as const;
const SATURATIONS = [0, 0.25, 0.6, 1] as const;
const LIGHTNESSES = [0, 0.05, 0.15, 0.3, 0.5, 0.7, 0.85, 0.95, 1] as const;

describe("themeFromPalette: text is readable whatever the picture", () => {
  it("meets WCAG AA on every checked pair, for flat pictures across the colour space and both modes", () => {
    let themes = 0;
    for (const h of HUES) {
      for (const s of SATURATIONS) {
        for (const l of LIGHTNESSES) {
          const palette = flat(hsl(h, s, l));
          for (const mode of MODES) {
            const { colors } = themeFromPalette(palette, mode);
            const failing = auditAa(colors).filter((c) => !c.pass);
            expect(failing.map((c) => `${c.label} ${c.ratio.toFixed(2)}`), `hsl(${h} ${s} ${l}) ${mode}`).toEqual([]);
            themes += 1;
          }
        }
      }
    }
    expect(themes).toBe(HUES.length * SATURATIONS.length * LIGHTNESSES.length * MODES.length);
  });

  it("meets AA with every accent candidate of busy pictures, in both modes", () => {
    const busy = [
      picture(20, [{ color: [250, 220, 40], count: 100 }, { color: [20, 30, 90], count: 200 }, { color: [200, 40, 120], count: 100 }]),
      picture(20, [{ color: [255, 255, 240], count: 300 }, { color: [255, 230, 0], count: 60 }, { color: [0, 255, 200], count: 40 }]),
      picture(20, [{ color: [5, 5, 5], count: 300 }, { color: [0, 80, 255], count: 60 }, { color: [255, 0, 60], count: 40 }]),
      picture(20, [{ color: [128, 128, 128], count: 300 }, { color: [128, 140, 128], count: 100 }]),
    ];
    for (const grid of busy) {
      const palette = paletteOf(grid);
      for (const mode of MODES) {
        const accents = palette.accents.length > 0 ? palette.accents : [undefined];
        for (const accent of accents) {
          const { colors } = themeFromPalette(palette, mode, accent);
          expect(auditAa(colors).filter((c) => !c.pass)).toEqual([]);
        }
      }
    }
  });

  it("holds on the extremes: a white wall, a black wall and mid grey", () => {
    for (const color of [[255, 255, 255], [0, 0, 0], [128, 128, 128]] as const) {
      for (const mode of MODES) {
        expect(auditAa(themeFromPalette(flat(color), mode).colors).every((c) => c.pass), `${color} ${mode}`).toBe(true);
      }
    }
  });

  it("measures the stored colours, not the ones it meant to store", () => {
    const { colors } = themeFromPalette(flat([250, 220, 40]), "light");
    const text = parseColor(colors.text);
    const bg = parseColor(colors.bg);
    expect(text && bg && contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("produces every role as a colour the theme file format accepts", () => {
    const { colors } = themeFromPalette(flat([40, 90, 200]), "dark");
    expect(THEME_ROLES.every((role) => parseColor(colors[role]) !== null)).toBe(true);
    const doc = buildThemeDoc(themeFromPalette(flat([40, 90, 200]), "dark"), "dark", "From my wallpaper");
    expect(doc.id).toBe(WALLPAPER_THEME_ID);
    const checked = validateThemeDoc(JSON.parse(JSON.stringify(doc)));
    expect(checked.ok).toBe(true);
  });
});

describe("themeFromPalette: the picture shows through", () => {
  it("uses the picture's vivid colour as the accent when it already reads well", () => {
    const palette = paletteOf(picture(16, [{ color: [60, 62, 64], count: 192 }, { color: [230, 60, 90], count: 64 }]));
    const theme = themeFromPalette(palette, "dark");
    expect(theme.colors.accent).toBe("#e63c5a");
    expect(theme.colors.dotOn).toBe(theme.colors.accent);
    expect(theme.accentFromPicture).toBe(true);
    expect(theme.adjusted).not.toContain("accent");
  });

  it("moves an accent only as far as contrast needs: a pale yellow is darkened on a light theme", () => {
    const palette = paletteOf(picture(16, [{ color: [236, 236, 232], count: 192 }, { color: [250, 225, 60], count: 64 }]));
    const theme = themeFromPalette(palette, "light");
    const original = rgbToOklch(parseColor("#fae13c") ?? { r: 0, g: 0, b: 0, a: 1 });
    const accent = rgbToOklch(parseColor(theme.colors.accent) ?? { r: 0, g: 0, b: 0, a: 1 });
    expect(theme.adjusted).toContain("accent");
    expect(accent.l).toBeLessThan(original.l);
    expect(hueDistance(accent.h, original.h)).toBeLessThan(10);
    const bg = parseColor(theme.colors.bg);
    expect(bg && contrastRatio(parseColor(theme.colors.accent) ?? bg, bg)).toBeGreaterThanOrEqual(3);
  });

  it("lets the user pick which of the picture's colours is the accent", () => {
    const palette = paletteOf(
      picture(20, [{ color: [70, 70, 72], count: 280 }, { color: [230, 60, 90], count: 60 }, { color: [60, 190, 90], count: 60 }]),
    );
    expect(palette.accents.length).toBeGreaterThanOrEqual(2);
    const [first, second] = palette.accents;
    expect(themeFromPalette(palette, "dark", first).colors.accent).not.toBe(themeFromPalette(palette, "dark", second).colors.accent);
  });

  it("tints the surfaces with the colour most of the picture is made of", () => {
    const palette = paletteOf(picture(16, [{ color: [20, 40, 120], count: 224 }, { color: [250, 200, 60], count: 32 }]));
    const { colors } = themeFromPalette(palette, "dark");
    const bg = rgbToOklch(parseColor(colors.bg) ?? { r: 0, g: 0, b: 0, a: 1 });
    expect(hueDistance(bg.h, palette.backdrop.lch.h)).toBeLessThan(15);
    expect(bg.c).toBeGreaterThan(0.01);
    expect(bg.c).toBeLessThan(0.05);
  });

  it("keeps the surfaces nearly neutral under a grey picture, and uses the theme's own accent", () => {
    const dark = themeFromPalette(flat([100, 100, 100]), "dark");
    expect(dark.accentFromPicture).toBe(false);
    expect(dark.colors.accent).toBe(OBSIDIAN.colors.accent);
    expect(rgbToOklch(parseColor(dark.colors.bg) ?? { r: 0, g: 0, b: 0, a: 1 }).c).toBeLessThan(0.01);
    // Paper's red cannot carry a label at 4.5:1 as it is, so it is deepened slightly and keeps its hue.
    const light = themeFromPalette(flat([200, 200, 200]), "light");
    const paper = rgbToOklch(parseColor(PAPER.colors.accent) ?? { r: 0, g: 0, b: 0, a: 1 });
    const used = rgbToOklch(parseColor(light.colors.accent) ?? { r: 0, g: 0, b: 0, a: 1 });
    expect(light.accentFromPicture).toBe(false);
    expect(hueDistance(used.h, paper.h)).toBeLessThan(10);
  });

  it("keeps surfaces in the usual lightness band so the app looks like the app", () => {
    const { colors } = themeFromPalette(flat([20, 40, 120]), "dark");
    const bg = rgbToOklch(parseColor(colors.bg) ?? { r: 0, g: 0, b: 0, a: 1 });
    expect(bg.l).toBeGreaterThan(0.12);
    expect(bg.l).toBeLessThan(0.25);
  });

  it("gives the same theme for the same picture", () => {
    const palette = flat([200, 90, 40]);
    expect(themeFromPalette(palette, "dark")).toEqual(themeFromPalette(palette, "dark"));
  });
});

describe("suggestMode", () => {
  it("suggests dark for a dark picture and light for a light one", () => {
    expect(suggestMode(flat([10, 12, 24]))).toBe("dark");
    expect(suggestMode(flat([240, 238, 232]))).toBe("light");
  });

  it("decides by overall lightness, not by the biggest colour alone", () => {
    const mostlyLight = paletteOf(picture(10, [{ color: [250, 250, 250], count: 60 }, { color: [0, 0, 0], count: 40 }]));
    expect(suggestMode(mostlyLight)).toBe("light");
  });
});

describe("auditAa", () => {
  it("fails a theme whose text is the colour of its background", () => {
    const { colors } = themeFromPalette(flat([20, 40, 120]), "dark");
    const broken = { ...colors, text: colors.bg };
    expect(auditAa(broken).some((c) => c.label === "Text on background" && !c.pass)).toBe(true);
  });

  it("checks body text at 4.5 and the accent at 3, and lists a pair for each surface", () => {
    const checks = auditAa(themeFromPalette(flat([20, 40, 120]), "dark").colors);
    expect(checks.find((c) => c.label === "Text on cards")?.target).toBe(4.5);
    expect(checks.find((c) => c.label === "Accent on background")?.target).toBe(3);
    expect(new Set(checks.map((c) => c.label)).size).toBe(checks.length);
  });

  it("is the same gate as the theme editor's for the pairs both check", () => {
    const { colors } = themeFromPalette(flat([90, 200, 120]), "light");
    const text = parseColor(colors.text);
    const bg = parseColor(colors.bg);
    const audit = auditAa(colors).find((c) => c.label === "Text on background");
    expect(audit?.ratio).toBeCloseTo(text && bg ? contrastRatio(text, bg) : 0, 10);
    expect(formatColor(bg ?? { r: 0, g: 0, b: 0, a: 1 })).toBe(colors.bg);
  });
});

import { describe, expect, it } from "vitest";
import { AURUM, BUILTIN_THEMES, OBSIDIAN, PAPER } from "../../design-system/themes";
import { DEFAULT_SETTINGS } from "../model/defaults";
import type { ThemeSelection } from "../model/types";
import { msUntilNextSwitch, resolveThemeId, effectiveEdgeMargin } from "./appearance";
import { composite, contrastRatio, formatColor, parseColor, toCss } from "./color";
import { checkContrast, deriveColors, readableOn } from "./derive";
import { oklchToRgb, rgbToOklch } from "./oklch";
import {
  MAX_THEME_FILE_BYTES,
  parseThemeFile,
  serializeTheme,
  shadowFor,
  slugify,
  themeFileName,
  themeToDoc,
  toRuntimeTheme,
  uniqueThemeId,
  THEME_ROLES,
  type ThemeDoc,
} from "./schema";

describe("colour parsing", () => {
  it("reads hex in every length and rgb()/rgba()", () => {
    expect(parseColor("#e94248")).toEqual({ r: 233, g: 66, b: 72, a: 1 });
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#0008")?.a).toBeCloseTo(0.533, 2);
    expect(parseColor("#11111180")?.a).toBeCloseTo(0.502, 2);
    expect(parseColor("rgba(22, 22, 22, 0.86)")).toEqual({ r: 22, g: 22, b: 22, a: 0.86 });
    expect(parseColor("rgb(10 20 30 / 50%)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
  });

  it("rejects names, malformed values and out-of-range channels instead of guessing", () => {
    for (const bad of ["red", "#12", "#ggg", "rgb(300, 0, 0)", "rgba(0, 0, 0, 2)", "", "url(x)", "#e94248; color: red"]) {
      expect(parseColor(bad), bad).toBeNull();
    }
  });

  it("formats to canonical hex and round-trips", () => {
    expect(formatColor({ r: 233, g: 66, b: 72, a: 1 })).toBe("#e94248");
    expect(formatColor({ r: 0, g: 0, b: 0, a: 0.5 })).toBe("#00000080");
    expect(parseColor(formatColor({ r: 1, g: 2, b: 3, a: 0.25 }))).toMatchObject({ r: 1, g: 2, b: 3 });
    expect(toCss({ r: 22, g: 22, b: 22, a: 0.86 })).toBe("rgba(22, 22, 22, 0.86)");
  });

  it("computes WCAG contrast", () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    expect(contrastRatio(white, black)).toBeCloseTo(21, 1);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
    expect(composite({ r: 255, g: 255, b: 255, a: 0.5 }, black).r).toBeCloseTo(127.5, 1);
  });
});

describe("OKLCH", () => {
  it("round-trips sRGB colours within one step per channel", () => {
    for (const hex of ["#e94248", "#e2b453", "#111111", "#e8e6e3", "#3b82f6", "#00ff88", "#ffffff"]) {
      const c = parseColor(hex);
      if (!c) throw new Error(hex);
      const back = oklchToRgb(rgbToOklch(c));
      expect(Math.abs(back.r - c.r), hex).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - c.g), hex).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - c.b), hex).toBeLessThanOrEqual(1);
    }
  });

  it("puts white at lightness 1 and black at 0, with no chroma", () => {
    expect(rgbToOklch({ r: 255, g: 255, b: 255, a: 1 }).l).toBeCloseTo(1, 3);
    expect(rgbToOklch({ r: 0, g: 0, b: 0, a: 1 }).l).toBeCloseTo(0, 3);
    expect(rgbToOklch({ r: 128, g: 128, b: 128, a: 1 }).c).toBeLessThan(0.001);
  });

  it("maps an out-of-gamut colour to a valid one that keeps its lightness and hue", () => {
    const vivid = oklchToRgb({ l: 0.7, c: 0.4, h: 150 });
    for (const channel of [vivid.r, vivid.g, vivid.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
    const back = rgbToOklch(vivid);
    expect(back.l).toBeCloseTo(0.7, 1);
    expect(Math.abs(back.h - 150)).toBeLessThan(6);
  });
});

describe("palette derivation", () => {
  const accents = ["#e94248", "#e2b453", "#3b82f6", "#22c55e", "#a855f7", "#ffffff", "#111111", "#808080"];

  it("produces a full valid palette for any accent in both modes", () => {
    for (const accent of accents) {
      for (const mode of ["dark", "light"] as const) {
        const palette = deriveColors(accent, mode);
        expect(palette, `${accent} ${mode}`).not.toBeNull();
        for (const role of THEME_ROLES) expect(parseColor(palette?.[role] ?? ""), `${accent} ${mode} ${role}`).not.toBeNull();
      }
    }
  });

  it("keeps body text readable on its background and on cards, whatever the accent", () => {
    for (const accent of accents) {
      for (const mode of ["dark", "light"] as const) {
        const palette = deriveColors(accent, mode);
        if (!palette) throw new Error("no palette");
        const checks = checkContrast(palette);
        const byLabel = Object.fromEntries(checks.map((c) => [c.label, c]));
        expect(byLabel["Text on background"]?.ratio, `${accent} ${mode}`).toBeGreaterThan(7);
        expect(byLabel["Text on cards"]?.pass, `${accent} ${mode}`).toBe(true);
        expect(byLabel["Label on accent"]?.pass, `${accent} ${mode}`).toBe(true);
      }
    }
  });

  it("derives light backgrounds for light mode and dark for dark", () => {
    const dark = rgbToOklch(parseColor(deriveColors("#e94248", "dark")?.bg ?? "") ?? { r: 0, g: 0, b: 0, a: 1 });
    const light = rgbToOklch(parseColor(deriveColors("#e94248", "light")?.bg ?? "") ?? { r: 0, g: 0, b: 0, a: 1 });
    expect(dark.l).toBeLessThan(0.25);
    expect(light.l).toBeGreaterThan(0.85);
  });

  it("tints neutrals with the accent's hue, faintly", () => {
    const bg = parseColor(deriveColors("#3b82f6", "dark")?.bg ?? "");
    const accentHue = rgbToOklch(parseColor("#3b82f6") ?? { r: 0, g: 0, b: 0, a: 1 }).h;
    const lch = rgbToOklch(bg ?? { r: 0, g: 0, b: 0, a: 1 });
    expect(lch.c).toBeLessThan(0.03);
    expect(Math.abs(lch.h - accentHue)).toBeLessThan(25);
  });

  it("returns null for an unparseable accent", () => {
    expect(deriveColors("blue", "dark")).toBeNull();
  });

  it("chooses a readable label colour for the accent", () => {
    expect(readableOn({ r: 255, g: 255, b: 255, a: 1 })).toBe("#111111");
    expect(readableOn({ r: 17, g: 17, b: 17, a: 1 })).toBe("#ffffff");
  });

  it("built-in themes pass the body-text contrast check", () => {
    for (const theme of BUILTIN_THEMES) {
      const doc = themeToDoc(theme, theme.id, theme.name);
      const checks = checkContrast(doc.colors);
      expect(checks.find((c) => c.label === "Text on background")?.pass, theme.id).toBe(true);
    }
  });
});

describe("theme files", () => {
  const valid = (): ThemeDoc => themeToDoc(PAPER, "custom-ember", "Ember");

  it("accepts what it exports", () => {
    const result = parseThemeFile(serializeTheme(valid()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.theme).toEqual(valid());
  });

  it("converts the built-in themes to canonical documents", () => {
    for (const theme of [OBSIDIAN, PAPER, AURUM]) {
      const doc = themeToDoc(theme, "x", "X");
      for (const role of THEME_ROLES) expect(doc.colors[role]).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
    }
  });

  it("names every field that is wrong", () => {
    const bad = JSON.stringify({ ...valid(), mode: "grey", name: "", colors: { ...valid().colors, accent: "red", bg: 7 } });
    const result = parseThemeFile(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain('"mode"');
      expect(result.errors.join(" ")).toContain('"name"');
      expect(result.errors.join(" ")).toContain("colors.accent");
      expect(result.errors.join(" ")).toContain("colors.bg");
    }
  });

  it("rejects invalid JSON, non-objects, oversized files and files from a newer app", () => {
    expect(parseThemeFile("{ nope")).toEqual({ ok: false, errors: ["The file is not valid JSON."] });
    expect(parseThemeFile("[]").ok).toBe(false);
    expect(parseThemeFile(" ".repeat(MAX_THEME_FILE_BYTES + 1)).ok).toBe(false);
    const future = parseThemeFile(JSON.stringify({ ...valid(), schema: 7 }));
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.errors[0]).toContain("newer version");
  });

  it("rejects a file of the wrong kind", () => {
    expect(parseThemeFile(JSON.stringify({ ...valid(), kind: "dotdock-backup" })).ok).toBe(false);
  });

  it("accepts a hand-written theme without schema or kind, and clamps shadow strength", () => {
    const { schema: _s, kind: _k, ...rest } = valid();
    void _s;
    void _k;
    const result = parseThemeFile(JSON.stringify({ ...rest, shadowStrength: 9 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.theme.shadowStrength).toBe(1);
  });

  it("limits the name length and never trusts the id in the file", () => {
    const result = parseThemeFile(JSON.stringify({ ...valid(), name: "x".repeat(200), id: "../../etc/passwd" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.theme.name).toHaveLength(40);
      expect(result.theme.id).toMatch(/^custom-/);
    }
  });

  it("makes safe file names and unique ids that never shadow a built-in", () => {
    expect(slugify("  Café Crème!! ")).toBe("cafe-creme");
    expect(slugify("???")).toBe("theme");
    expect(themeFileName(valid())).toBe("ember.theme.json");
    expect(uniqueThemeId("Ember", new Set())).toBe("custom-ember");
    expect(uniqueThemeId("Ember", new Set(["custom-ember", "custom-ember-2"]))).toBe("custom-ember-3");
  });

  it("builds the runtime theme the design system expects, with a mode-appropriate shadow", () => {
    const runtime = toRuntimeTheme(valid());
    expect(runtime).toMatchObject({ id: "custom-ember", name: "Ember", mode: "light" });
    expect(Object.keys(runtime.colors)).toHaveLength(13);
    expect(runtime.colors.shadow).toBe(shadowFor("light", 0.4));
    expect(shadowFor("dark", 0.4)).toBe("0 12px 32px rgba(0, 0, 0, 0.36)");
    expect(shadowFor("dark", 0)).toBe("0 12px 32px rgba(0, 0, 0, 0)");
  });
});

describe("theme selection", () => {
  const sel = (over: Partial<ThemeSelection>): ThemeSelection => ({ ...DEFAULT_SETTINGS.theme, ...over });
  const at = (h: number, m = 0): Date => new Date(2026, 0, 15, h, m, 0, 0);

  it("fixed mode ignores the clock and the OS", () => {
    expect(resolveThemeId(sel({ mode: "fixed", fixedId: "aurum" }), at(3), true)).toBe("aurum");
  });

  it("system mode follows the OS preference", () => {
    const s = sel({ mode: "system", lightId: "paper", darkId: "obsidian" });
    expect(resolveThemeId(s, at(12), true)).toBe("obsidian");
    expect(resolveThemeId(s, at(12), false)).toBe("paper");
  });

  it("schedule mode switches at the configured times", () => {
    const s = sel({ mode: "schedule", lightId: "paper", darkId: "aurum", lightFrom: "07:00", darkFrom: "19:00" });
    expect(resolveThemeId(s, at(6, 59), false)).toBe("aurum");
    expect(resolveThemeId(s, at(7, 0), false)).toBe("paper");
    expect(resolveThemeId(s, at(18, 59), false)).toBe("paper");
    expect(resolveThemeId(s, at(19, 0), false)).toBe("aurum");
    expect(resolveThemeId(s, at(0, 0), false)).toBe("aurum");
  });

  it("schedule mode handles a light period that wraps past midnight", () => {
    const s = sel({ mode: "schedule", lightId: "paper", darkId: "aurum", lightFrom: "22:00", darkFrom: "06:00" });
    expect(resolveThemeId(s, at(23), false)).toBe("paper");
    expect(resolveThemeId(s, at(3), false)).toBe("paper");
    expect(resolveThemeId(s, at(12), false)).toBe("aurum");
  });

  it("tells the timer when to wake up next, and nothing when the theme is not time-based", () => {
    const s = sel({ mode: "schedule", lightFrom: "07:00", darkFrom: "19:00" });
    expect(msUntilNextSwitch(s, at(18, 0))).toBe(60 * 60 * 1000);
    expect(msUntilNextSwitch(s, at(19, 0))).toBe(12 * 60 * 60 * 1000);
    expect(msUntilNextSwitch(s, at(23, 0))).toBe(8 * 60 * 60 * 1000);
    expect(msUntilNextSwitch(sel({ mode: "system" }), at(1))).toBeNull();
  });

  it("uses a display's own margin when it has one", () => {
    const settings = { ...DEFAULT_SETTINGS, displays: { left: { edgeMargin: 60 } } };
    expect(effectiveEdgeMargin(settings, "left")).toBe(60);
    expect(effectiveEdgeMargin(settings, "right")).toBe(DEFAULT_SETTINGS.layout.edgeMargin);
  });
});

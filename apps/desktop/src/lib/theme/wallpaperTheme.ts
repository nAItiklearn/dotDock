import { OBSIDIAN, PAPER } from "../../design-system/themes";
import { THEME_SCHEMA } from "../model/types";
import { composite, contrastRatio, formatColor, parseColor, type Rgba } from "./color";
import { DARK_RAMP, INK, LIGHT_RAMP, STATUS, WHITE, readableOn, type ContrastCheck, type Step } from "./derive";
import { oklchToRgb, rgbToOklch, type Oklch } from "./oklch";
import type { Swatch, WallpaperPalette } from "./palette";
import { DEFAULT_SHADOW_STRENGTH, THEME_FILE_KIND, type ThemeDoc, type ThemeRole } from "./schema";

/**
 * Maps the palette of a picture onto the design tokens, with text that is readable whatever the
 * picture. Colour comes from the picture (the accent, and the faint tint of every surface); lightness
 * does not, because it is what contrast depends on. Every foreground role is then checked against
 * every surface it can sit on, and moved along the lightness scale, by the least amount, until it
 * meets WCAG 2.2 AA. The check runs on the 8-bit colours that are stored, so what passes here passes
 * on screen.
 */

export type WallpaperMode = "dark" | "light";

/** The generated theme is one custom theme, replaced each time, so repeated tries do not pile up. */
export const WALLPAPER_THEME_ID = "custom-from-wallpaper";

/** WCAG 2.2 AA: 4.5:1 for text, 3:1 for graphical objects such as the accent. */
const AA_TEXT = 4.5;
const AA_GRAPHIC = 3;
/** Step of the search for a passing lightness; finer than one 8-bit step of grey. */
const LIGHTNESS_STEP = 1 / 256;
/** The neutral ramps' own chroma is the unit of tint: 1 reproduces `deriveColors`, more follows the picture. */
const TINT_UNIT_CHROMA = 0.006;
const TINT_MAX_SCALE = 5;
/** A picture lighter than halfway between the two themes' backgrounds gets the light theme. */
const LIGHT_PICTURE_LIGHTNESS = (DARK_RAMP.bg.l + LIGHT_RAMP.bg.l) / 2;

const opaque = (hex: string): Rgba => ({ ...(parseColor(hex) ?? INK), a: 1 });
/** A picture with no colour of its own keeps the theme's own accent. */
const FALLBACK_ACCENT: Readonly<Record<WallpaperMode, Rgba>> = {
  dark: opaque(OBSIDIAN.colors.accent),
  light: opaque(PAPER.colors.accent),
};

export function suggestMode(palette: WallpaperPalette): WallpaperMode {
  return palette.lightness > LIGHT_PICTURE_LIGHTNESS ? "light" : "dark";
}

/** The colour as it will be stored: rounded to 8 bits, as `formatColor` writes it. */
function settle(color: Rgba): Rgba {
  return parseColor(formatColor(color)) ?? color;
}

/**
 * Walks a colour's lightness in `direction` (+1 lighter, -1 darker) from where it is and returns the
 * first colour that passes, so a colour only moves as far as it must. Black and white always pass
 * against the surfaces used here, which is where the walk ends.
 */
function firstPassing(start: Oklch, direction: 1 | -1, passes: (color: Rgba) => boolean): Rgba {
  for (let l = start.l; l >= 0 && l <= 1; l += direction * LIGHTNESS_STEP) {
    const color = settle(oklchToRgb({ ...start, l }));
    if (passes(color)) return color;
  }
  return settle(oklchToRgb({ ...start, l: direction === 1 ? 1 : 0 }));
}

export interface WallpaperTheme {
  readonly colors: Readonly<Record<ThemeRole, string>>;
  /** False when the picture has no colour and the theme's own accent was used. */
  readonly accentFromPicture: boolean;
  /** Roles that had to move to meet AA, so Settings can say so. */
  readonly adjusted: readonly ThemeRole[];
}

/** Chooses the lightness-free parts of the theme from the picture and fixes the rest for contrast. */
export function themeFromPalette(
  palette: WallpaperPalette,
  mode: WallpaperMode,
  accent: Swatch | undefined = palette.accents[0],
): WallpaperTheme {
  const ramp = mode === "dark" ? DARK_RAMP : LIGHT_RAMP;
  const direction = mode === "dark" ? 1 : -1;
  const accentStart = accent?.color ?? FALLBACK_ACCENT[mode];
  const accentLch = rgbToOklch(accentStart);

  // Surfaces take the hue of what most of the picture is made of, and as much of its colour as stays quiet.
  // A backdrop with no colour of its own leaves them as neutral as the built-in themes, tinted by the accent's hue.
  const coloured = palette.backdrop.lch.c >= TINT_UNIT_CHROMA;
  const hue = coloured ? palette.backdrop.lch.h : accentLch.h;
  const tint = coloured ? Math.min(TINT_MAX_SCALE, palette.backdrop.lch.c / TINT_UNIT_CHROMA) : 1;
  const neutral = (step: Step): Rgba => settle(oklchToRgb({ l: step.l, c: step.c * tint, h: hue }, step.a ?? 1));
  const bg = neutral(ramp.bg);
  const surface = neutral(ramp.surface);
  const surface2 = neutral(ramp.surface2);
  // Cards are translucent: what is read against is the card over the background.
  const card = composite(surface, bg);
  const grounds = [bg, card, surface2];
  const readable = (color: Rgba): boolean => grounds.every((ground) => contrastRatio(color, ground) >= AA_TEXT);
  const ink = (color: Rgba): number => Math.max(contrastRatio(WHITE, color), contrastRatio(INK, color));

  const adjusted: ThemeRole[] = [];
  const keepIfPassing = (role: ThemeRole, start: Oklch, passes: (color: Rgba) => boolean): Rgba => {
    const original = settle(oklchToRgb(start));
    if (passes(original)) return original;
    adjusted.push(role);
    return firstPassing(start, direction, passes);
  };

  const text = keepIfPassing("text", { l: ramp.text.l, c: ramp.text.c * tint, h: hue }, readable);
  const textDim = keepIfPassing("textDim", { l: ramp.textDim.l, c: ramp.textDim.c * tint, h: hue }, readable);
  const danger = keepIfPassing("danger", STATUS[mode].danger, readable);
  const success = keepIfPassing("success", STATUS[mode].success, readable);

  const accentPasses = (color: Rgba): boolean =>
    contrastRatio(color, bg) >= AA_GRAPHIC && contrastRatio(color, card) >= AA_GRAPHIC && ink(color) >= AA_TEXT;
  const accentColor = accentPasses(accentStart) ? accentStart : firstPassing(accentLch, direction, accentPasses);
  if (accentColor !== accentStart) adjusted.push("accent");

  const colors: Record<ThemeRole, string> = {
    bg: formatColor(bg),
    surface: formatColor(surface),
    surface2: formatColor(surface2),
    border: formatColor(neutral(ramp.border)),
    text: formatColor(text),
    textDim: formatColor(textDim),
    accent: formatColor(accentColor),
    accentInk: readableOn(accentColor),
    dotOn: formatColor(accentColor),
    dotOff: formatColor(neutral(ramp.dotOff)),
    danger: formatColor(danger),
    success: formatColor(success),
  };
  return { colors, accentFromPicture: accent !== undefined, adjusted };
}

/** Every pair the generated theme guarantees, measured on the stored colours. */
export function auditAa(colors: Readonly<Record<ThemeRole, string>>): readonly ContrastCheck[] {
  const get = (role: ThemeRole): Rgba => parseColor(colors[role]) ?? INK;
  const bg = get("bg");
  const grounds: readonly (readonly [string, Rgba])[] = [
    ["background", bg],
    ["cards", composite(get("surface"), bg)],
    ["raised cards", get("surface2")],
  ];
  const text: readonly (readonly [string, ThemeRole])[] = [
    ["Text", "text"],
    ["Secondary text", "textDim"],
    ["Warning", "danger"],
    ["Good", "success"],
  ];
  const pairs: (readonly [string, Rgba, Rgba, number])[] = [];
  for (const [name, role] of text) {
    for (const [groundName, ground] of grounds) pairs.push([`${name} on ${groundName}`, get(role), ground, AA_TEXT]);
  }
  pairs.push(["Label on accent", get("accentInk"), get("accent"), AA_TEXT]);
  for (const [groundName, ground] of grounds.slice(0, 2)) {
    pairs.push([`Accent on ${groundName}`, get("accent"), ground, AA_GRAPHIC]);
  }
  return pairs.map(([label, fg, back, target]) => {
    const ratio = contrastRatio(fg, back);
    return { label, ratio, target, pass: ratio >= target };
  });
}

/** The theme as a custom-theme document, ready to save and select. */
export function buildThemeDoc(theme: WallpaperTheme, mode: WallpaperMode, name: string): ThemeDoc {
  return {
    kind: THEME_FILE_KIND,
    schema: THEME_SCHEMA,
    id: WALLPAPER_THEME_ID,
    name,
    mode,
    colors: theme.colors,
    shadowStrength: DEFAULT_SHADOW_STRENGTH,
  };
}

import { composite, contrastRatio, formatColor, parseColor, type Rgba } from "./color";
import { oklchToRgb, rgbToOklch } from "./oklch";
import type { ThemeRole } from "./schema";

type Palette = Readonly<Record<ThemeRole, string>>;

/** Neutral ramp per mode: OKLCH lightness and chroma, plus an alpha where the role is translucent. */
interface Step {
  readonly l: number;
  readonly c: number;
  readonly a?: number;
}

const DARK_RAMP = {
  bg: { l: 0.175, c: 0.005 },
  surface: { l: 0.205, c: 0.006, a: 0.86 },
  surface2: { l: 0.235, c: 0.007 },
  border: { l: 0.95, c: 0.005, a: 0.08 },
  text: { l: 0.91, c: 0.006 },
  textDim: { l: 0.64, c: 0.008 },
  dotOff: { l: 0.95, c: 0.005, a: 0.14 },
} as const satisfies Record<string, Step>;

const LIGHT_RAMP = {
  bg: { l: 0.915, c: 0.006 },
  surface: { l: 0.965, c: 0.004, a: 0.92 },
  surface2: { l: 0.88, c: 0.007 },
  border: { l: 0.17, c: 0.005, a: 0.06 },
  text: { l: 0.17, c: 0.005 },
  textDim: { l: 0.52, c: 0.008 },
  dotOff: { l: 0.17, c: 0.005, a: 0.12 },
} as const satisfies Record<string, Step>;

/** Status colours keep fixed hues so "danger" stays red whatever the accent is. */
const STATUS = {
  dark: { danger: { l: 0.7, c: 0.14, h: 22 }, success: { l: 0.74, c: 0.05, h: 135 } },
  light: { danger: { l: 0.52, c: 0.17, h: 24 }, success: { l: 0.54, c: 0.08, h: 135 } },
} as const;

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const INK: Rgba = { r: 17, g: 17, b: 17, a: 1 };

/** Text colour for use on top of the accent: whichever of white or near-black reads better. */
export function readableOn(background: Rgba): string {
  return formatColor(contrastRatio(WHITE, background) >= contrastRatio(INK, background) ? WHITE : INK);
}

/**
 * Builds a whole palette from one accent colour. Neutrals take the accent's hue at very low
 * chroma, so surfaces feel related to it without looking tinted.
 */
export function deriveColors(accentHex: string, mode: "light" | "dark"): Palette | null {
  const accent = parseColor(accentHex);
  if (!accent) return null;
  const hue = rgbToOklch({ ...accent, a: 1 }).h;
  const ramp = mode === "dark" ? DARK_RAMP : LIGHT_RAMP;
  const neutral = (step: Step): string => formatColor(oklchToRgb({ l: step.l, c: step.c, h: hue }, step.a ?? 1));
  const status = STATUS[mode];
  const solidAccent = { ...accent, a: 1 };
  const palette: Record<ThemeRole, string> = {
    bg: neutral(ramp.bg),
    surface: neutral(ramp.surface),
    surface2: neutral(ramp.surface2),
    border: neutral(ramp.border),
    text: neutral(ramp.text),
    textDim: neutral(ramp.textDim),
    accent: formatColor(solidAccent),
    accentInk: readableOn(solidAccent),
    dotOn: formatColor(solidAccent),
    dotOff: neutral(ramp.dotOff),
    danger: formatColor(oklchToRgb(status.danger)),
    success: formatColor(oklchToRgb(status.success)),
  };
  return palette;
}

export interface ContrastCheck {
  readonly label: string;
  readonly ratio: number;
  /** Minimum the pair should meet for its purpose. */
  readonly target: number;
  readonly pass: boolean;
}

/** The pairs a theme editor should warn about. Body text needs 4.5, large display type 3. */
export function checkContrast(colors: Palette): readonly ContrastCheck[] {
  const get = (role: ThemeRole): Rgba => parseColor(colors[role]) ?? { r: 0, g: 0, b: 0, a: 1 };
  const bg = get("bg");
  // Cards are translucent, so measure against what is visible: the card composited over the background.
  const card = composite(get("surface"), bg);
  const pairs: readonly (readonly [string, ThemeRole, Rgba, number])[] = [
    ["Text on background", "text", bg, 4.5],
    ["Secondary text on background", "textDim", bg, 3],
    ["Text on cards", "text", card, 4.5],
    ["Label on accent", "accentInk", get("accent"), 4.5],
    ["Accent on background", "accent", bg, 3],
  ];
  return pairs.map(([label, fg, back, target]) => {
    const ratio = contrastRatio(get(fg), back);
    return { label, ratio, target, pass: ratio >= target };
  });
}

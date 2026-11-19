import type { Rgba } from "./color";

/** OKLCH: perceptual lightness (0..1), chroma (~0..0.4), hue in degrees. Matrices from Björn Ottosson's OKLab. */
export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

const toLinear = (byte: number): number => {
  const s = byte / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function rgbToOklch(color: Rgba): Oklch {
  const r = toLinear(color.r);
  const g = toLinear(color.g);
  const b = toLinear(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, bb);
  // Hue is meaningless for greys; pin it so round trips are stable.
  const hue = chroma < 1e-4 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { l: lightness, c: chroma, h: hue };
}

interface Linear {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function oklchToLinear({ l, c, h }: Oklch): Linear {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: 4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp,
    g: -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
    b: -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp,
  };
}

const GAMUT_EPSILON = 1e-6;
const inGamut = ({ r, g, b }: Linear): boolean =>
  [r, g, b].every((v) => v >= -GAMUT_EPSILON && v <= 1 + GAMUT_EPSILON);

/**
 * Converts to sRGB. A colour outside the sRGB gamut keeps its lightness and hue and loses chroma
 * until it fits, which stays harmonious where per-channel clipping would shift the hue.
 */
export function oklchToRgb(color: Oklch, alpha = 1): Rgba {
  let candidate = color;
  if (!inGamut(oklchToLinear(candidate))) {
    let lo = 0;
    let hi = color.c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...color, c: mid }))) lo = mid;
      else hi = mid;
    }
    candidate = { ...color, c: lo };
  }
  const lin = oklchToLinear(candidate);
  const byte = (v: number): number => Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, v))))) * 255);
  return { r: byte(lin.r), g: byte(lin.g), b: byte(lin.b), a: alpha };
}

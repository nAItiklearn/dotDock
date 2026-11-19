/** sRGB colour with 0..255 channels and 0..1 alpha. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i;

const clampByte = (n: number): number => Math.min(255, Math.max(0, Math.round(n)));
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Accepts #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() and rgba(). Anything else is rejected, never guessed. */
export function parseColor(text: string): Rgba | null {
  const value = text.trim();
  const hex = HEX.exec(value);
  if (hex?.[1]) {
    let digits = hex[1];
    if (digits.length <= 4) digits = [...digits].map((c) => c + c).join("");
    const channel = (i: number): number => Number.parseInt(digits.slice(i, i + 2), 16);
    return { r: channel(0), g: channel(2), b: channel(4), a: digits.length === 8 ? channel(6) / 255 : 1 };
  }
  const fn = FUNCTIONAL.exec(value);
  if (fn?.[1] && fn[2] && fn[3]) {
    const [r, g, b] = [fn[1], fn[2], fn[3]].map(Number) as [number, number, number];
    if (r > 255 || g > 255 || b > 255) return null;
    const alphaText = fn[4];
    let a = 1;
    if (alphaText !== undefined) {
      a = alphaText.endsWith("%") ? Number.parseFloat(alphaText) / 100 : Number.parseFloat(alphaText);
      if (!Number.isFinite(a) || a < 0 || a > 1) return null;
    }
    return { r: clampByte(r), g: clampByte(g), b: clampByte(b), a };
  }
  return null;
}

const byteHex = (n: number): string => clampByte(n).toString(16).padStart(2, "0");

/** Canonical form: #rrggbb, or #rrggbbaa when the colour is translucent. */
export function formatColor(c: Rgba): string {
  const base = `#${byteHex(c.r)}${byteHex(c.g)}${byteHex(c.b)}`;
  return c.a >= 1 ? base : `${base}${byteHex(clamp01(c.a) * 255)}`;
}

/** CSS-ready string; keeps alpha readable for debugging in devtools. */
export function toCss(c: Rgba): string {
  return c.a >= 1
    ? formatColor(c)
    : `rgba(${clampByte(c.r)}, ${clampByte(c.g)}, ${clampByte(c.b)}, ${Math.round(clamp01(c.a) * 100) / 100})`;
}

export function withAlpha(c: Rgba, a: number): Rgba {
  return { ...c, a: clamp01(a) };
}

function linear(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an opaque colour. */
export function luminance(c: Rgba): number {
  return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
}

/** Alpha-composites `top` over an opaque `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = clamp01(top.a);
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

/** WCAG contrast ratio, 1..21. A translucent foreground is composited over the background first. */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const opaqueBg = bg.a < 1 ? composite(bg, { r: 0, g: 0, b: 0, a: 1 }) : bg;
  const lf = luminance(composite(fg, opaqueBg));
  const lb = luminance(opaqueBg);
  const [hi, lo] = lf > lb ? [lf, lb] : [lb, lf];
  return (hi + 0.05) / (lo + 0.05);
}

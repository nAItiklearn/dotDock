/** The most colours the picker remembers. */
export const HISTORY_SIZE = 8;

const HEX = /^#?([0-9a-f]{6})$/i;
const SHORT_HEX = /^#?([0-9a-f]{3})$/i;

/** "#RRGGBB" in upper case from "#abc", "ABCDEF" or "#abcdef", or null when it is not a colour. */
export function normaliseHex(text: string): string | null {
  const trimmed = text.trim();
  const long = HEX.exec(trimmed)?.[1];
  if (long) return `#${long.toUpperCase()}`;
  const short = SHORT_HEX.exec(trimmed)?.[1];
  return short ? `#${[...short].map((c) => c + c).join("").toUpperCase()}` : null;
}

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function toRgb(hex: string): Rgb | null {
  const normal = normaliseHex(hex);
  if (!normal) return null;
  return { r: parseInt(normal.slice(1, 3), 16), g: parseInt(normal.slice(3, 5), 16), b: parseInt(normal.slice(5, 7), 16) };
}

const LINEAR_CUTOFF = 0.04045;
/** The relative luminance at which black and white text have the same contrast. */
const INK_CROSSOVER = 0.179;

/** WCAG relative luminance of an sRGB colour, 0 (black) to 1 (white). */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= LINEAR_CUTOFF ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Black or white, whichever reads better on `hex`. */
export function inkFor(hex: string): "#000000" | "#FFFFFF" {
  const rgb = toRgb(hex);
  return rgb && luminance(rgb) > INK_CROSSOVER ? "#000000" : "#FFFFFF";
}

/** "rgb(12, 34, 56)" as a designer reads it. */
export function rgbText(hex: string): string {
  const rgb = toRgb(hex);
  return rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : "";
}

/** The newest colour first, once each, no more than `HISTORY_SIZE`. */
export function remember(history: readonly string[], hex: string): string[] {
  const normal = normaliseHex(hex);
  if (!normal) return [...history];
  return [normal, ...history.filter((h) => h !== normal)].slice(0, HISTORY_SIZE);
}

export function parseHistory(raw: string | null): string[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .flatMap((v) => (typeof v === "string" ? [normaliseHex(v)] : []))
      .filter((v): v is string => v !== null)
      .slice(0, HISTORY_SIZE);
  } catch {
    return [];
  }
}

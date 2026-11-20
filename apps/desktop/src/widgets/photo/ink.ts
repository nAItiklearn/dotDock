/**
 * The ink a polaroid's caption is printed in, and the hairline that keeps a border's edge visible.
 *
 * Grey and accent borders follow the theme, which can be any colour (custom themes, themes taken
 * from the user's wallpaper), so no fixed ink is legible on every one of them. The ink is picked
 * here with the WCAG formula from the resolved colours: the warm pair the photo border uses
 * (paper and near-black) when one of them reaches body-text contrast, else pure black or white.
 * Black or white always reaches it: their worst case, a colour of luminance 0.18, is 4.58 : 1.
 */
import { composite, contrastRatio, parseColor, type Rgba } from "../../lib/theme/color";

/** WCAG AA for body text; the caption is 10 px mono caps, so it gets no large-text allowance. */
export const CAPTION_CONTRAST = 4.5;

/** The tokens a caption can be printed in, in order of preference: the warm pair, then the strongest pair. */
export const CAPTION_INKS = ["--photo-ink", "--photo-mat", "--photo-ink-max", "--photo-mat-max"] as const;
export type CaptionInk = (typeof CAPTION_INKS)[number];

export type InkPalette = Readonly<Record<CaptionInk, Rgba>>;

const better = (a: CaptionInk, b: CaptionInk, palette: InkPalette, on: Rgba): CaptionInk =>
  contrastRatio(palette[a], on) >= contrastRatio(palette[b], on) ? a : b;

/**
 * The caption ink for a border colour. A translucent border is measured as it is seen: over the
 * theme's background.
 */
export function captionInk(line: Rgba, backdrop: Rgba, palette: InkPalette): CaptionInk {
  const band = line.a < 1 ? composite(line, { ...backdrop, a: 1 }) : line;
  const warm = better("--photo-ink", "--photo-mat", palette, band);
  if (contrastRatio(palette[warm], band) >= CAPTION_CONTRAST) return warm;
  return better("--photo-ink-max", "--photo-mat-max", palette, band);
}

/** Reads the resolved colours from an element's computed style; null when one is not a plain colour. */
export function readInkInputs(style: CSSStyleDeclaration): { line: Rgba; backdrop: Rgba; palette: InkPalette } | null {
  const read = (name: string): Rgba | null => parseColor(style.getPropertyValue(name));
  const line = read("--photo-line");
  const backdrop = read("--bg");
  const entries = CAPTION_INKS.map((name) => [name, read(name)] as const);
  if (!line || !backdrop || entries.some(([, c]) => c === null)) return null;
  return { line, backdrop, palette: Object.fromEntries(entries) as InkPalette };
}

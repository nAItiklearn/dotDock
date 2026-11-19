/**
 * Picks an accent colour from cover art: the average of its vivid, mid-tone pixels.
 * Grey, black or white art returns null so the theme accent stays in charge.
 */
export interface ArtworkAccent {
  readonly color: string;
  /** Text colour that stays readable on top of `color`. */
  readonly ink: string;
}

const MIN_ALPHA = 128;
const MIN_TOTAL_WEIGHT = 2;
const LUMINANCE_SPLIT = 0.55;
const DARK_INK = "#111111";
const LIGHT_INK = "#ffffff";
const CHANNELS = 4;
const MAX_CHANNEL = 255;

const luminance = (r: number, g: number, b: number): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / MAX_CHANNEL;

/** `pixels` is RGBA data as returned by canvas getImageData. */
export function accentFromPixels(pixels: ArrayLike<number>): ArtworkAccent | null {
  let weight = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i + 3 < pixels.length; i += CHANNELS) {
    if ((pixels[i + 3] ?? 0) < MIN_ALPHA) continue;
    const pr = pixels[i] ?? 0;
    const pg = pixels[i + 1] ?? 0;
    const pb = pixels[i + 2] ?? 0;
    const max = Math.max(pr, pg, pb) / MAX_CHANNEL;
    const min = Math.min(pr, pg, pb) / MAX_CHANNEL;
    const lightness = (max + min) / 2;
    const chroma = max - min;
    const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));
    // Vivid pixels near mid lightness count most; near-black and near-white count for nothing.
    const w = saturation * (1 - Math.abs(2 * lightness - 1));
    weight += w;
    r += pr * w;
    g += pg * w;
    b += pb * w;
  }
  if (weight < MIN_TOTAL_WEIGHT) return null;
  const red = Math.round(r / weight);
  const green = Math.round(g / weight);
  const blue = Math.round(b / weight);
  return {
    color: `rgb(${red} ${green} ${blue})`,
    ink: luminance(red, green, blue) > LUMINANCE_SPLIT ? DARK_INK : LIGHT_INK,
  };
}

const SAMPLE_SIZE = 24;

/** Decodes a data URL and reads its accent. Resolves null when the image cannot be read. */
export async function accentFromArtwork(dataUrl: string): Promise<ArtworkAccent | null> {
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return accentFromPixels(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
  } catch {
    return null;
  }
}

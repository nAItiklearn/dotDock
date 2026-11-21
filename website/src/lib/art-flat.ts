/**
 * Which pieces of site art are drawn as flattened pictures (tools/flatten-art.mjs) instead of CSS masks: every band
 * and every layer of a scene. A scene then paints a few <img> elements, decoded off the main thread, where it used
 * to paint dozens of full-width masks on it. The small sprites keep their masks: their wings and fins are separate
 * layers that beat on their own.
 */
import manifest from "../assets/art/manifest.json" with { type: "json" };

const SPRITES = /^(live-dragonfly|live-fish-|vista-butterfly-)/;

export function isFlat(name: string): boolean {
  return /^(band-|live-|vista-)/.test(name) && !SPRITES.test(name);
}

export const FLAT_PIECES: readonly string[] = Object.keys(manifest).filter(isFlat);

/** The file of one flattened render: piece, narrow or wide, theme and pixel ratio. */
export function flatFile(name: string, variant: string, theme: string, scale: number): string {
  return `${name}-${variant}-${theme}-${scale}x.webp`;
}

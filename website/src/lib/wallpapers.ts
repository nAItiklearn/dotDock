/**
 * The product's original wallpapers shown in the desktop shots, downscaled by tools/make-wallpapers.mjs.
 * One natural scene per theme (a halftone range over rolling hills, a wind-swept meadow with dotted wild
 * flowers), chosen so the widget cluster sits on the calm left half of the image.
 * Names are the product's own (assets/wallpapers/manifest.json).
 */
import ridgeLightLarge from "../assets/wallpapers/halftone-ridge-light-1920.webp?url";
import ridgeLightSmall from "../assets/wallpapers/halftone-ridge-light-640.webp?url";
import ridgeDarkLarge from "../assets/wallpapers/halftone-ridge-dark-1920.webp?url";
import ridgeDarkSmall from "../assets/wallpapers/halftone-ridge-dark-640.webp?url";
import meadowDarkLarge from "../assets/wallpapers/meadow-dots-dark-1920.webp?url";
import meadowDarkSmall from "../assets/wallpapers/meadow-dots-dark-640.webp?url";
import type { ThemeId } from "./themes";

export interface Wallpaper {
  readonly name: string;
  readonly large: string;
  readonly small: string;
}

export const WALLPAPERS: Record<ThemeId, Wallpaper> = {
  paper: { name: "Screen Ridge", large: ridgeLightLarge, small: ridgeLightSmall },
  obsidian: { name: "Screen Ridge", large: ridgeDarkLarge, small: ridgeDarkSmall },
  aurum: { name: "Wind Meadow", large: meadowDarkLarge, small: meadowDarkSmall },
};

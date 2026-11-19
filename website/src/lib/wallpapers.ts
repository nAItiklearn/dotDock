/**
 * The product's original wallpapers, downscaled by tools/make-wallpapers.mjs. One per theme,
 * chosen so the widget cluster sits on the calm left half of the image.
 * Names are the product's own (assets/wallpapers/manifest.json).
 */
import arcRedLarge from "../assets/wallpapers/arc-red-dark-1920.webp?url";
import arcRedSmall from "../assets/wallpapers/arc-red-dark-640.webp?url";
import paperRingLarge from "../assets/wallpapers/paper-ring-light-1920.webp?url";
import paperRingSmall from "../assets/wallpapers/paper-ring-light-640.webp?url";
import liquidGoldLarge from "../assets/wallpapers/liquid-gold-dark-1920.webp?url";
import liquidGoldSmall from "../assets/wallpapers/liquid-gold-dark-640.webp?url";
import type { ThemeId } from "./themes";

export interface Wallpaper {
  readonly name: string;
  readonly large: string;
  readonly small: string;
}

export const WALLPAPERS: Record<ThemeId, Wallpaper> = {
  obsidian: { name: "Phosphor Red", large: arcRedLarge, small: arcRedSmall },
  paper: { name: "Paper Ring", large: paperRingLarge, small: paperRingSmall },
  aurum: { name: "Molten Gold", large: liquidGoldLarge, small: liquidGoldSmall },
};

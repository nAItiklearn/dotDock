/**
 * The owner's photos, used only when the site is built with DOTDOCK_OWNER_PHOTOS=1 (astro.config.mjs swaps this
 * module in for owner-photos.off.ts). The files live in website/private-photos/, which git ignores.
 */
import type { ImageMetadata } from "astro";

const photos: Readonly<Record<string, ImageMetadata>> = import.meta.glob<ImageMetadata>("/private-photos/*.{jpg,jpeg,png,webp}", { eager: true, import: "default" });
export default photos;

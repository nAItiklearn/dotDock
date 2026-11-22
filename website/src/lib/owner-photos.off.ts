/** The owner's photos while DOTDOCK_OWNER_PHOTOS is off: none, so no photo file enters the build (astro.config.mjs). */
import type { ImageMetadata } from "astro";

const photos: Readonly<Record<string, ImageMetadata>> = {};
export default photos;

import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";
import { fileURLToPath } from "node:url";
import { ownerPhotosOn } from "./src/lib/photos.ts";

// The owner's photos enter the build only with DOTDOCK_OWNER_PHOTOS=1 (src/lib/photos.ts, docs/BLOCKERS.md).
const ownerPhotos = fileURLToPath(new URL(`./src/lib/owner-photos.${ownerPhotosOn(process.env) ? "on" : "off"}.ts`, import.meta.url));

// Static pages, plus one on-demand route (src/pages/api/visits.ts) for the anonymous visit counter, so the
// Vercel adapter is needed. The captures on the Features page are resized at build time by Astro's sharp image
// service into a few widths each; nothing is resized at request time (the adapter's image service is off).
export default defineConfig({
  output: "static",
  adapter: vercel({ imageService: false }),
  site: process.env.SITE_URL || undefined,
  compressHTML: true,
  devToolbar: { enabled: false },
  build: {
    // Inline the stylesheet so first paint never waits on a CSS request.
    inlineStylesheets: "always",
  },
  vite: {
    resolve: { alias: { "owner-photos": ownerPhotos } },
    build: { target: "es2022", cssMinify: "lightningcss" },
  },
});

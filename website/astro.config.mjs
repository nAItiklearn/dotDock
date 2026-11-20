import { defineConfig, passthroughImageService } from "astro/config";
import vercel from "@astrojs/vercel";

// Static pages, plus one on-demand route (src/pages/api/visits.ts) for the anonymous visit counter, so the
// Vercel adapter is needed. The site uses no Astro image processing (art and photos are optimised WebP made
// by tools), so the image service is off and nothing is bundled for it.
export default defineConfig({
  output: "static",
  adapter: vercel({ imageService: false }),
  image: { service: passthroughImageService() },
  site: process.env.SITE_URL || undefined,
  compressHTML: true,
  devToolbar: { enabled: false },
  build: {
    // Inline the stylesheet so first paint never waits on a CSS request.
    inlineStylesheets: "always",
  },
  vite: {
    build: { target: "es2022", cssMinify: "lightningcss" },
  },
});

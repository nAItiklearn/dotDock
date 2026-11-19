import { defineConfig } from "astro/config";

// Static output, no integrations. Everything is first-party and self-hosted.
export default defineConfig({
  output: "static",
  site: process.env.SITE_URL || undefined,
  compressHTML: true,
  devToolbar: { enabled: false },
  build: {
    // One page: inline the stylesheet so first paint never waits on a CSS request.
    inlineStylesheets: "always",
  },
  vite: {
    build: { target: "es2022", cssMinify: "lightningcss" },
  },
});

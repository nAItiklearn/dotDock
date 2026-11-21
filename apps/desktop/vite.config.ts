import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, "package.json"), "utf8")) as { version: string };

// Two entry points: the always-on desktop overlay (kept tiny for fast boot)
// and the on-demand settings window.
export default defineConfig({
  plugins: [react()],
  // Only web assets are served/embedded; wallpapers ship as installer resources, not in the exe.
  publicDir: resolve(here, "../../assets/web"),
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Pre-bundle the Tauri API so dev never serves a stale optimised copy (504 "Outdated Optimize Dep").
  optimizeDeps: { include: ["@tauri-apps/api/core", "@tauri-apps/api/event"] },
  server: {
    port: 1420,
    strictPort: true,
    // About reads THIRD_PARTY_NOTICES.md from the repository root, one level above this app's workspace.
    fs: { allow: [resolve(here, "../..")] },
  },
  build: {
    target: "es2022",
    cssCodeSplit: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        overlay: resolve(here, "overlay.html"),
        island: resolve(here, "island.html"),
        settings: resolve(here, "settings.html"),
      },
    },
  },
});

// Live QA: the theme colours a wallpaper gives, from its own accent and mode in the manifest, through the
// app's own deriveColors (loaded with Vite, so the code under test is the shipped code).
// Usage (from apps/desktop): node ../../tools/qa/home-live/palettes.mjs <file.jpg>... > palettes.json
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Vite lives with the app, not beside this script.
const appRequire = createRequire(new URL("../../../apps/desktop/package.json", import.meta.url));
const { createServer } = await import(pathToFileURL(appRequire.resolve("vite")).href);

const manifest = JSON.parse(readFileSync(new URL("../../../assets/wallpapers/manifest.json", import.meta.url), "utf8"));
const entries = Array.isArray(manifest) ? manifest : manifest.wallpapers;
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
const { deriveColors } = await vite.ssrLoadModule("/src/lib/theme/derive.ts");
const out = process.argv.slice(2).map((file) => {
  const w = entries.find((e) => e.file === file);
  if (!w) throw new Error(`${file} is not in the wallpaper manifest`);
  return { file, name: w.name, mode: w.mode, accent: w.accent, colors: deriveColors(w.accent, w.mode) };
});
await vite.close();
process.stdout.write(JSON.stringify(out, null, 2));

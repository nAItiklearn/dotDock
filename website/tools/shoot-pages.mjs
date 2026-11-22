// Full-page screenshots of the preview server's pages at the given widths, for visual QA (JPEG, 1x).
// Usage: node tools/shoot-pages.mjs <out-dir> [paths] [widths] [origin]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { launch, profileDir, sleep } from "./cdp.mjs";

const ROOT = join(import.meta.dirname, "..");
const out = process.argv[2];
if (!out) throw new Error("Give an output folder.");
const paths = (process.argv[3] ?? "/,/features,/download,/privacy,/license,/faq").split(",");
const widths = (process.argv[4] ?? "1440,390").split(",").map(Number);
const origin = process.argv[5] ?? "http://127.0.0.1:4330";
/** Longest page height captured, so a screenshot stays a size an image viewer opens. */
const MAX_H = 16000;

mkdirSync(out, { recursive: true });
const c = await launch({ profile: profileDir(ROOT) });
try {
  for (const w of widths) {
    for (const path of paths) {
      await c.viewport(w, 900, 1);
      await c.goto(`${origin}${path}`, 1200);
      // Walk down the page so every reveal and lazy picture has come in, then back to the top.
      const height = await c.eval("document.documentElement.scrollHeight");
      for (let y = 0; y < height; y += 700) {
        await c.eval(`scrollTo(0, ${y})`);
        await sleep(120);
      }
      await c.eval("scrollTo(0, 0)");
      await sleep(800);
      const h = Math.min(MAX_H, await c.eval("document.documentElement.scrollHeight"));
      await c.viewport(w, h, 1);
      await sleep(900);
      const png = await c.shot({ x: 0, y: 0, width: w, height: h });
      const name = `${path === "/" ? "home" : path.slice(1).replaceAll("/", "-")}-${w}.jpg`;
      writeFileSync(join(out, name), await sharp(png).jpeg({ quality: 78 }).toBuffer());
      console.log(name, h);
    }
  }
} finally {
  c.close();
}

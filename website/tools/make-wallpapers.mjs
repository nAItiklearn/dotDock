// Resizes the product's original wallpapers into the small WebP copies the site ships.
// Run by hand when the wallpaper set changes; the outputs are committed, so `pnpm build` never
// needs the 4K originals.
//
//   node tools/make-wallpapers.mjs [path/to/assets/wallpapers]
//
// Defaults to ../assets/wallpapers (the repository's wallpaper folder).
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(process.argv[2] ?? join(here, "..", "..", "assets", "wallpapers"));
const out = join(here, "..", "src", "assets", "wallpapers");

// One wallpaper per theme, chosen so the widget cluster sits on the calm left half.
const PICKS = ["arc-red-dark", "paper-ring-light", "liquid-gold-dark"];
const WIDTHS = [1920, 640];

await mkdir(out, { recursive: true });
for (const name of PICKS) {
  for (const width of WIDTHS) {
    const file = join(out, `${name}-${width}.webp`);
    const info = await sharp(join(source, `${name}.jpg`))
      .resize({ width })
      .webp({ quality: 82, effort: 6 })
      .toFile(file);
    console.log(`${name}-${width}.webp  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} KB`);
  }
}

// Flattens the scene art into one picture per piece, render, pixel ratio and theme (src/assets/art-flat), so a scene
// paints a handful of <img> elements instead of dozens of full-width CSS masks. The masks were decoded and painted
// on the main thread the first time a scene scrolled into view, which froze a fast scroll for up to a second and a
// half; an <img decoding="async"> is decoded off it. Every colour and opacity comes from the same tokens the CSS
// uses (src/lib/themes.ts, styles/meadow-colours.css, styles/art.css), so a flattened piece looks the same as its
// masks did. Small sprites whose parts move on their own (wings, fins) stay masks.
//   node tools/flatten-art.mjs   (redraws only pieces whose masks or colours changed, per art-flat/sources.json)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { THEMES } from "../src/lib/themes.ts";
import { FLAT_PIECES, flatFile } from "../src/lib/art-flat.ts";

const ROOT = join(import.meta.dirname, "..");
const ART = join(ROOT, "src", "assets", "art");
const OUT = join(ROOT, "src", "assets", "art-flat");
const manifest = JSON.parse(readFileSync(join(ART, "manifest.json"), "utf8"));

/** The scene colours meadow-colours.css adds to the theme tokens, read from that file so there is one source. */
function sceneColours() {
  const css = readFileSync(join(ROOT, "src", "styles", "meadow-colours.css"), "utf8").split(String.fromCharCode(13)).join("");
  const block = (selector) => {
    const at = css.indexOf(selector);
    if (at < 0) throw new Error(`meadow-colours.css has no ${selector}`);
    const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
    return Object.fromEntries([...body.matchAll(/--vista-(\w+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  };
  const paper = block(".vista,\n.live {");
  return { paper, obsidian: block('html[data-theme="obsidian"]'), aurum: block('html[data-theme="aurum"]') };
}
const SCENE = sceneColours();

/** A role's colour in a theme, as styles/art.css and styles/meadow-colours.css paint it. */
function colour(role, theme) {
  const c = theme.colors;
  const scene = SCENE[theme.id];
  const map = {
    ink: c.artStone, far: c.artFar, mid: c.artMid, near: c.artNear, stalk: c.artNear, cloud: c.artCloud, sea: c.artSea,
    line: c.artPetal, accent: c.artSun, petal: c.artPetal, gold: c.artGold, heart: c.artHeart, grain: c.artStone,
    glow: c.artGold, pink: scene.pink, violet: scene.violet, apricot: scene.apricot, cream: scene.cream,
  };
  const hex = map[role];
  if (!hex) throw new Error(`No colour for the art role ${role}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** A role's opacity: the grain is a light touch everywhere; in a scene the far ridges soften on a dark page. */
function opacity(role, theme, name) {
  if (role === "grain") return 0.4;
  const scene = name.startsWith("live-") || name.startsWith("vista-");
  if (scene && theme.id !== "paper" && (role === "far" || role === "mid")) return 0.85;
  return 1;
}

/** The roles of a piece in the order the page stacks its layers (lib/art.ts, artRoles). */
function roles(piece) {
  return [...new Set(Object.values(piece.variants).flatMap((v) => Object.keys(v.layers).map((l) => l.split("-")[0])))];
}

async function flatten(name, variant, scale, theme) {
  const piece = manifest[name];
  const v = piece.variants[variant];
  let w = 0, h = 0, rgb = null, alpha = null;
  for (const role of roles(piece)) {
    const mode = theme.id === "paper" ? "paper" : "dark";
    const layer = v.layers[role] ?? v.layers[`${role}-${mode}`];
    const file = layer?.[String(scale)]?.file ?? layer?.["1"]?.file;
    if (!file) continue;
    const { data, info } = await sharp(join(ART, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (!rgb) {
      ({ width: w, height: h } = info);
      rgb = new Float32Array(w * h * 3);
      alpha = new Float32Array(w * h);
    }
    let src = data;
    if (info.width !== w || info.height !== h) {
      src = await sharp(join(ART, file)).ensureAlpha().resize(w, h, { fit: "fill" }).raw().toBuffer();
    }
    const [r, g, b] = colour(role, theme);
    const o = opacity(role, theme, name);
    for (let p = 0, q = 3; p < w * h; p++, q += 4) {
      const a = (src[q] / 255) * o;
      if (a === 0) continue;
      const keep = 1 - a;
      rgb[p * 3] = r * a + rgb[p * 3] * keep;
      rgb[p * 3 + 1] = g * a + rgb[p * 3 + 1] * keep;
      rgb[p * 3 + 2] = b * a + rgb[p * 3 + 2] * keep;
      alpha[p] = a + alpha[p] * keep;
    }
  }
  if (!rgb) throw new Error(`${name}/${variant} has no layers`);
  // Premultiplied over-compositing above; store straight (unpremultiplied) colour for the WebP.
  const out = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const a = alpha[p];
    out[p * 4 + 3] = Math.round(a * 255);
    if (a > 0) for (let k = 0; k < 3; k++) out[p * 4 + k] = Math.round(rgb[p * 3 + k] / a);
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).webp({ lossless: true, effort: 4 }).toBuffer();
}

mkdirSync(OUT, { recursive: true });
const SOURCES = join(OUT, "sources.json");
const before = existsSync(SOURCES) ? JSON.parse(readFileSync(SOURCES, "utf8")) : {};
const after = {};
const wanted = new Set();
let made = 0;
for (const name of FLAT_PIECES) {
  const piece = manifest[name];
  if (!piece) throw new Error(`Unknown art piece ${name}`);
  // What a piece's pictures are drawn from: every mask it has, and every colour of every theme.
  const hash = createHash("sha1");
  for (const v of Object.values(piece.variants)) for (const l of Object.values(v.layers)) for (const s of Object.values(l)) hash.update(readFileSync(join(ART, s.file)));
  hash.update(JSON.stringify([THEMES.map((t) => t.colors), SCENE]));
  after[name] = hash.digest("hex");
  for (const variant of Object.keys(piece.variants)) {
    for (const scale of [1, 2]) {
      for (const theme of THEMES) {
        const file = flatFile(name, variant, theme.id, scale);
        wanted.add(file);
        const path = join(OUT, file);
        if (existsSync(path) && before[name] === after[name]) continue;
        writeFileSync(path, await flatten(name, variant, scale, theme));
        made++;
      }
    }
  }
}
for (const stale of readdirSync(OUT).filter((f) => f.endsWith(".webp") && !wanted.has(f))) unlinkSync(join(OUT, stale));
writeFileSync(SOURCES, JSON.stringify(after, null, 1) + String.fromCharCode(10));
console.log(`flatten-art: ${made} written, ${wanted.size} in all`);

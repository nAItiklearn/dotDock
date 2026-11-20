/**
 * Site art. tools/site-art renders every piece as WebP masks (white, coverage in the alpha channel);
 * this module turns the generated manifest into the CSS that paints them with the page's own theme
 * colours, so the art follows the theme switch without a second download.
 *
 * A piece has variants (a narrow and a wide render with the dot pitch kept constant in CSS pixels)
 * and layers named after their role: `ink`, `accent`, `body`, or a pair `ink-paper` / `ink-dark`
 * for art whose lighting has to read the right way round on a light and on a dark page.
 */
import manifest from "../assets/art/manifest.json";

type Scales = Record<string, { file: string; w: number; h: number; bytes: number }>;
interface Variant {
  w: number;
  h: number;
  layers: Record<string, Scales>;
}
interface Piece {
  variants: Record<string, Variant>;
}

const PIECES = manifest as unknown as Record<string, Piece>;
const URLS = import.meta.glob<string>("../assets/art/*.webp", { eager: true, query: "?url", import: "default" });

/** Viewport width from which the wide render is used. */
const WIDE_FROM_PX = 900;

export type ArtName = keyof typeof manifest;

function url(file: string): string {
  const found = URLS[`../assets/art/${file}`];
  if (!found) throw new Error(`Site art file missing: ${file}`);
  return found;
}

/** The layer roles of a piece (`ink-paper` and `ink-dark` both play the `ink` role). */
export function artRoles(name: string): string[] {
  const piece = PIECES[name];
  const variant = piece && Object.values(piece.variants)[0];
  if (!variant) throw new Error(`Unknown site art: ${name}`);
  return [...new Set(Object.keys(variant.layers).map((l) => l.split("-")[0] ?? l))];
}

/** Pixel size of the variant an element shows at a given width class, for layout rules. */
export function artSize(name: string, variant: string): { w: number; h: number } {
  const v = PIECES[name]?.variants[variant];
  if (!v) throw new Error(`Unknown site art variant: ${name}/${variant}`);
  return { w: v.w, h: v.h };
}

function maskRule(layer: Scales): string {
  const one = layer["1"];
  const two = layer["2"];
  if (!one) throw new Error("Site art layer without a 1x file");
  const set = two ? `url(${url(one.file)}) 1x, url(${url(two.file)}) 2x` : `url(${url(one.file)}) 1x`;
  return `-webkit-mask-image:-webkit-image-set(${set});mask-image:image-set(${set})`;
}

function selector(name: string, layer: string): string {
  const [role, mode] = layer.split("-");
  const base = `.art--${name} .art__${role}`;
  if (mode === "paper") return `html[data-theme="paper"] ${base}`;
  if (mode === "dark") return `html:not([data-theme="paper"]) ${base}`;
  return base;
}

/** Stylesheet text for every piece; emitted once in the page head. */
export function artCss(): string {
  const out: string[] = [];
  for (const [name, piece] of Object.entries(PIECES)) {
    const names = Object.keys(piece.variants);
    // Mobile first: the narrow render is the default, the wide one takes over on larger screens.
    const base = piece.variants["narrow"] ?? Object.values(piece.variants)[0];
    const wide = names.includes("narrow") ? piece.variants["wide"] : undefined;
    if (!base) continue;
    const emit = (v: Variant): string =>
      Object.entries(v.layers)
        .map(([layer, scales]) => `${selector(name, layer)}{${maskRule(scales)}}`)
        .join("") + `.art--${name}{--art-w:${v.w};--art-h:${v.h}}`;
    out.push(emit(base));
    if (wide) out.push(`@media (min-width:${WIDE_FROM_PX}px){${emit(wide)}}`);
  }
  return out.join("");
}

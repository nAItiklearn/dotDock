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

/**
 * Pieces below the fold download their masks only when they come near the screen: their rules apply once
 * scripts/chrome.ts has put `art--on` on the piece. The hero's pieces are not lazy.
 */
export function isLazyArt(name: string): boolean {
  return name.startsWith("scene-") || name.startsWith("band-") || name.startsWith("live-");
}

function url(file: string): string {
  const found = URLS[`../assets/art/${file}`];
  if (!found) throw new Error(`Site art file missing: ${file}`);
  return found;
}

/** The layer roles of a piece, over all its renders (`ink-paper` and `ink-dark` both play the `ink` role). */
export function artRoles(name: string): string[] {
  const piece = PIECES[name];
  if (!piece) throw new Error(`Unknown site art: ${name}`);
  // Every role either render uses: a narrow render can hold a flower colour the wide one does not, and back.
  return [...new Set(Object.values(piece.variants).flatMap((v) => Object.keys(v.layers).map((l) => l.split("-")[0] ?? l)))];
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
  const base = `.art--${name}${isLazyArt(name) ? ".art--on" : ""} .art__${role}`;
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
    // A role one render has and the other lacks (no flower of that colour in it) has no mask there; without
    // one its layer would paint the whole box, so that render hides it and the other shows it again.
    const roles = (v: Variant) => new Set(Object.keys(v.layers).map((l) => l.split("-")[0] ?? l));
    const all = new Set(Object.values(piece.variants).flatMap((v) => [...roles(v)]));
    const emit = (v: Variant): string => {
      const has = roles(v);
      const uneven = [...all].filter((r) => !Object.values(piece.variants).every((o) => roles(o).has(r)));
      return (
        Object.entries(v.layers)
          .map(([layer, scales]) => `${selector(name, layer)}{${maskRule(scales)}}`)
          .join("") +
        uneven.map((r) => `.art--${name} .art__${r}{display:${has.has(r) ? "block" : "none"}}`).join("") +
        `.art--${name}{--art-w:${v.w};--art-h:${v.h}}`
      );
    };
    out.push(emit(base));
    if (wide) out.push(`@media (min-width:${WIDE_FROM_PX}px){${emit(wide)}}`);
  }
  return out.join("");
}

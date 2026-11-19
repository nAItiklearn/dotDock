/**
 * DEV ONLY. Original, simple generated glyphs standing in for the icons the core serves as `dock-icon://`
 * PNGs. They are geometric on purpose: no brand logo, nothing copied from any app.
 */
const GLYPHS = [
  // ring
  '<circle cx="128" cy="128" r="52" fill="none" stroke="#fff" stroke-width="22"/>',
  // two bars
  '<rect x="78" y="70" width="34" height="116" rx="12" fill="#fff"/><rect x="144" y="100" width="34" height="86" rx="12" fill="#fff" opacity=".7"/>',
  // triangle
  '<path d="M128 70 190 180H66Z" fill="#fff" stroke="#fff" stroke-width="14" stroke-linejoin="round"/>',
  // diamond
  '<path d="M128 66 190 128 128 190 66 128Z" fill="#fff"/>',
  // wave
  '<path d="M60 136c22-44 44-44 68 0s46 44 68 0" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round"/>',
  // grid of dots
  '<g fill="#fff"><circle cx="92" cy="92" r="15"/><circle cx="164" cy="92" r="15"/><circle cx="92" cy="164" r="15"/><circle cx="164" cy="164" r="15" opacity=".6"/></g>',
  // half disc
  '<path d="M64 150a64 64 0 0 1 128 0Z" fill="#fff"/><rect x="64" y="166" width="128" height="22" rx="11" fill="#fff" opacity=".6"/>',
  // chevrons
  '<path d="M92 84 136 128 92 172M138 84 182 128 138 172" fill="none" stroke="#fff" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>',
  // plus
  '<path d="M128 72v112M72 128h112" stroke="#fff" stroke-width="24" stroke-linecap="round"/>',
  // pill
  '<rect x="66" y="98" width="124" height="60" rx="30" fill="#fff"/><circle cx="160" cy="128" r="16" fill="currentColor" opacity=".35"/>',
  // arc
  '<path d="M70 168a64 64 0 1 1 116 0" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round"/><circle cx="128" cy="168" r="12" fill="#fff"/>',
  // stripes
  '<g fill="#fff"><rect x="68" y="76" width="120" height="20" rx="10"/><rect x="68" y="118" width="86" height="20" rx="10" opacity=".75"/><rect x="68" y="160" width="104" height="20" rx="10" opacity=".5"/></g>',
] as const;

/** Muted background pairs (top, bottom) in the range of real app icons, none of them a product's brand colour. */
const PALETTES = [
  ["#3b4a6b", "#222c44"],
  ["#c0563f", "#8a3326"],
  ["#2f7a6e", "#1c4f47"],
  ["#7a5aa6", "#4d3578"],
  ["#c79a3a", "#8c6a1f"],
  ["#4c7fb8", "#2b5483"],
  ["#b8527a", "#7f3354"],
  ["#5a6b4a", "#38452c"],
  ["#2b2b2e", "#101012"],
  ["#d8d4cc", "#a9a49a"],
] as const;

const DARK_GLYPH_ON_LIGHT = 9;

function hashOf(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** A data-URL icon, always the same for the same seed. */
export function sampleIcon(seed: string): string {
  const h = hashOf(seed);
  const paletteIndex = h % PALETTES.length;
  const palette = PALETTES[paletteIndex] ?? PALETTES[0];
  const glyph = GLYPHS[(h >>> 4) % GLYPHS.length] ?? GLYPHS[0];
  const ink = paletteIndex === DARK_GLYPH_ON_LIGHT ? "#2b2b2e" : "#fff";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette[0]}"/><stop offset="1" stop-color="${palette[1]}"/></linearGradient></defs>` +
    `<rect x="16" y="16" width="224" height="224" rx="56" fill="url(#g)"/>` +
    `<g color="${palette[1]}">${glyph.replaceAll("#fff", ink)}</g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

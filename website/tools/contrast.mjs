// Fails when a theme pairing that carries text drops below WCAG AA. Run by `pnpm build`.
import { THEMES } from "../src/lib/themes.ts";

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const MIN = 4.5;
let failed = false;

for (const { id, colors: c } of THEMES) {
  const pairs = [
    ["text on bg", c.text, c.bg],
    ["text on surface-2", c.text, c.surface2],
    ["text-dim on bg", c.textDim, c.bg],
    ["text-dim on surface-2", c.textDim, c.surface2],
    ["accent-text on bg", c.accentText, c.bg],
    ["accent-text on surface-2", c.accentText, c.surface2],
    ["accent-ink on accent", c.accentInk, c.accent],
  ];
  for (const [label, fg, bg] of pairs) {
    const r = ratio(fg, bg);
    const ok = r >= MIN;
    if (!ok) failed = true;
    if (process.argv.includes("--verbose") || !ok) {
      console.log(`${ok ? "ok  " : "FAIL"} ${id.padEnd(9)} ${label.padEnd(26)} ${r.toFixed(2)}`);
    }
  }
}

if (failed) {
  console.error(`Contrast below ${MIN}:1 in at least one theme pairing.`);
  process.exit(1);
}
console.log(`Theme contrast ok (all text pairings >= ${MIN}:1).`);

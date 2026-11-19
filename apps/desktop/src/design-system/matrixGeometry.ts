import { glyphFor, glyphRows, type GlyphSet } from "./glyphs";

export type MatrixStyle = "dots" | "blocks" | "stripes";

export interface MatrixGeometry {
  /** Width and height in cell units. */
  readonly cols: number;
  readonly rows: number;
  /** SVG path data for lit and unlit cells, in cell units (1 cell = 1 unit). */
  readonly litPath: string;
  readonly offPath: string;
}

/** Proportions inside one cell, in cell units. */
const DOT_RADIUS = 0.4;
const BLOCK_RADIUS = 0.42;
const STRIPE_TOP = 0.18;
const STRIPE_HEIGHT = 0.5;
const GLYPH_GAP = 1;

const fmt = (n: number): string => (Math.round(n * 1000) / 1000).toString();

function circle(cx: number, cy: number, r: number): string {
  return `M${fmt(cx - r)} ${fmt(cy)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-2 * r)} 0Z`;
}

/** Rectangle with an independent radius per corner (tl, tr, br, bl). */
function roundedRect(x: number, y: number, w: number, h: number, radii: readonly [number, number, number, number]): string {
  const [tl, tr, br, bl] = radii;
  return [
    `M${fmt(x + tl)} ${fmt(y)}`,
    `H${fmt(x + w - tr)}`,
    tr ? `a${fmt(tr)} ${fmt(tr)} 0 0 1 ${fmt(tr)} ${fmt(tr)}` : "",
    `V${fmt(y + h - br)}`,
    br ? `a${fmt(br)} ${fmt(br)} 0 0 1 ${fmt(-br)} ${fmt(br)}` : "",
    `H${fmt(x + bl)}`,
    bl ? `a${fmt(bl)} ${fmt(bl)} 0 0 1 ${fmt(-bl)} ${fmt(-bl)}` : "",
    `V${fmt(y + tl)}`,
    tl ? `a${fmt(tl)} ${fmt(tl)} 0 0 1 ${fmt(tl)} ${fmt(-tl)}` : "",
    "Z",
  ].join("");
}

/** Places glyphs left to right and returns a lit-cell lookup over the whole string. */
function layout(text: string, set: GlyphSet): { cols: number; rows: number; lit: boolean[][] } {
  const rows = glyphRows(set);
  const glyphs = [...text].map((ch) => glyphFor(set, ch));
  const cols = glyphs.reduce((sum, g, i) => sum + g.width + (i > 0 ? GLYPH_GAP : 0), 0);
  const lit: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  let x = 0;
  glyphs.forEach((g, i) => {
    if (i > 0) x += GLYPH_GAP;
    g.lit.forEach((row, r) =>
      row.forEach((on, c) => {
        const target = lit[r];
        if (on && target) target[x + c] = true;
      }),
    );
    x += g.width;
  });
  return { cols, rows, lit };
}

const geometryCache = new Map<string, MatrixGeometry>();

export function buildMatrix(text: string, style: MatrixStyle): MatrixGeometry {
  const key = `${style}\u0000${text}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;

  // Solid blocks need chunky strokes; dots and stripes read better with the fine set.
  const { cols, rows, lit } = layout(text, style === "blocks" ? "bold" : "fine");
  const on = (r: number, c: number): boolean => lit[r]?.[c] === true;
  const lits: string[] = [];
  const offs: string[] = [];

  for (let r = 0; r < rows; r++) {
    if (style === "stripes") {
      // Horizontal runs of lit cells become one pill-ended bar.
      let c = 0;
      while (c < cols) {
        if (!on(r, c)) { c++; continue; }
        const start = c;
        while (c < cols && on(r, c)) c++;
        const half = STRIPE_HEIGHT / 2;
        lits.push(roundedRect(start, r + STRIPE_TOP, c - start, STRIPE_HEIGHT, [half, half, half, half]));
      }
      continue;
    }
    for (let c = 0; c < cols; c++) {
      if (style === "dots") {
        (on(r, c) ? lits : offs).push(circle(c + 0.5, r + 0.5, DOT_RADIUS));
        continue;
      }
      if (!on(r, c)) continue;
      // Blocks merge into solid strokes; only convex outer corners are rounded.
      const up = on(r - 1, c), down = on(r + 1, c), left = on(r, c - 1), right = on(r, c + 1);
      const k = BLOCK_RADIUS;
      lits.push(roundedRect(c, r, 1, 1, [
        !up && !left ? k : 0,
        !up && !right ? k : 0,
        !down && !right ? k : 0,
        !down && !left ? k : 0,
      ]));
    }
  }

  const geometry: MatrixGeometry = { cols, rows, litPath: lits.join(""), offPath: offs.join("") };
  geometryCache.set(key, geometry);
  return geometry;
}

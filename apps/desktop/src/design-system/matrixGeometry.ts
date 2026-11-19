import { glyphFor, glyphRows, type Glyph, type GlyphSet } from "./glyphs";

/**
 * - dots: round lit dots on a fine grid, unlit cells optional.
 * - blocks: chunky merged strokes with rounded outer corners.
 * - stripes: every row of a glyph becomes one pill-ended horizontal bar.
 * - circles: blocks plus one oversized accent bead on each digit and a round colon.
 */
export type MatrixStyle = "dots" | "blocks" | "stripes" | "circles";

export interface MatrixGeometry {
  /** Width and height in cell units. */
  readonly cols: number;
  readonly rows: number;
  /** SVG path data in cell units (1 cell = 1 unit), one path per paint. */
  readonly litPath: string;
  readonly offPath: string;
  /** Beads painted in the accent colour (circles style). */
  readonly accentPath: string;
  /** Colon cells, kept apart so the colon can blink without touching the digits. */
  readonly blinkPath: string;
}

/** Proportions inside one cell, in cell units. */
const DOT_RADIUS = 0.4;
const BLOCK_RADIUS = 0.42;
const STRIPE_TOP = 0.18;
const STRIPE_HEIGHT = 0.5;
const GLYPH_GAP = 1;
const BEAD_RADIUS = 0.8;
const COLON = ":";

const fmt = (n: number): string => (Math.round(n * 1000) / 1000).toString();

export function circlePath(cx: number, cy: number, r: number): string {
  return `M${fmt(cx - r)} ${fmt(cy)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-2 * r)} 0Z`;
}

/** Rectangle with an independent radius per corner (tl, tr, br, bl). */
export function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radii: readonly [number, number, number, number],
): string {
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

interface Placed {
  readonly cols: number;
  readonly rows: number;
  readonly lit: boolean[][];
  /** Cells that belong to a colon glyph. */
  readonly colon: boolean[][];
  /** Per placed glyph: where it starts and what it is. */
  readonly spans: readonly { readonly x: number; readonly ch: string; readonly glyph: Glyph }[];
}

/** Places glyphs left to right and returns lit-cell lookups over the whole string. */
function layout(text: string, set: GlyphSet): Placed {
  const rows = glyphRows(set);
  const chars = [...text];
  const glyphs = chars.map((ch) => glyphFor(set, ch));
  const cols = glyphs.reduce((sum, g, i) => sum + g.width + (i > 0 ? GLYPH_GAP : 0), 0);
  const grid = (): boolean[][] => Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const lit = grid();
  const colon = grid();
  const spans: { x: number; ch: string; glyph: Glyph }[] = [];
  let x = 0;
  glyphs.forEach((g, i) => {
    if (i > 0) x += GLYPH_GAP;
    const ch = chars[i] ?? " ";
    spans.push({ x, ch, glyph: g });
    g.lit.forEach((row, r) =>
      row.forEach((on, c) => {
        if (!on) return;
        const target = lit[r];
        const marks = colon[r];
        if (target) target[x + c] = true;
        if (marks && ch === COLON) marks[x + c] = true;
      }),
    );
    x += g.width;
  });
  return { cols, rows, lit, colon, spans };
}

/**
 * Where a digit gets its bead: the first stroke end (a lit cell with a single lit neighbour)
 * in reading order, so beads sit where a stroke stops. Closed shapes use the bottom-right corner.
 */
export function beadAnchor(glyph: Glyph): { readonly row: number; readonly col: number } {
  const on = (r: number, c: number): boolean => glyph.lit[r]?.[c] === true;
  for (let r = 0; r < glyph.lit.length; r++) {
    for (let c = 0; c < glyph.width; c++) {
      if (!on(r, c)) continue;
      const neighbours = [on(r - 1, c), on(r + 1, c), on(r, c - 1), on(r, c + 1)].filter(Boolean).length;
      if (neighbours === 1) return { row: r, col: c };
    }
  }
  return { row: glyph.lit.length - 1, col: glyph.width - 1 };
}

const geometryCache = new Map<string, MatrixGeometry>();

export function buildMatrix(text: string, style: MatrixStyle): MatrixGeometry {
  const key = `${style}\u0000${text}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;

  // Solid shapes need chunky strokes; dots and stripes read better with the fine set.
  const solid = style === "blocks" || style === "circles";
  const { cols, rows, lit, colon, spans } = layout(text, solid ? "bold" : "fine");
  const on = (r: number, c: number): boolean => lit[r]?.[c] === true;
  const isColon = (r: number, c: number): boolean => colon[r]?.[c] === true;
  const lits: string[] = [];
  const offs: string[] = [];
  const colons: string[] = [];
  const beads: string[] = [];

  for (let r = 0; r < rows; r++) {
    if (style === "stripes") {
      // Horizontal runs of lit cells become one pill-ended bar.
      let c = 0;
      while (c < cols) {
        if (!on(r, c)) {
          c++;
          continue;
        }
        const start = c;
        const colonRun = isColon(r, c);
        while (c < cols && on(r, c) && isColon(r, c) === colonRun) c++;
        const half = STRIPE_HEIGHT / 2;
        (colonRun ? colons : lits).push(
          roundedRectPath(start, r + STRIPE_TOP, c - start, STRIPE_HEIGHT, [half, half, half, half]),
        );
      }
      continue;
    }
    for (let c = 0; c < cols; c++) {
      if (style === "dots") {
        if (!on(r, c)) offs.push(circlePath(c + 0.5, r + 0.5, DOT_RADIUS));
        else (isColon(r, c) ? colons : lits).push(circlePath(c + 0.5, r + 0.5, DOT_RADIUS));
        continue;
      }
      if (!on(r, c)) continue;
      if (style === "circles" && isColon(r, c)) {
        colons.push(circlePath(c + 0.5, r + 0.5, 0.5));
        continue;
      }
      // Blocks merge into solid strokes; only convex outer corners are rounded.
      const up = on(r - 1, c);
      const down = on(r + 1, c);
      const left = on(r, c - 1);
      const right = on(r, c + 1);
      const k = BLOCK_RADIUS;
      (isColon(r, c) ? colons : lits).push(
        roundedRectPath(c, r, 1, 1, [
          !up && !left ? k : 0,
          !up && !right ? k : 0,
          !down && !right ? k : 0,
          !down && !left ? k : 0,
        ]),
      );
    }
  }

  if (style === "circles") {
    for (const span of spans) {
      if (span.ch === COLON || span.ch === " ") continue;
      const { row, col } = beadAnchor(span.glyph);
      beads.push(circlePath(span.x + col + 0.5, row + 0.5, BEAD_RADIUS));
    }
  }

  const geometry: MatrixGeometry = {
    cols,
    rows,
    litPath: lits.join(""),
    offPath: offs.join(""),
    accentPath: beads.join(""),
    blinkPath: colons.join(""),
  };
  geometryCache.set(key, geometry);
  return geometry;
}

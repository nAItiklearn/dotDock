import { hash } from "../hash";
import { GROUND_ROW, SCENE_COLS, type Emit } from "./layout";

/** Columns over which the strip fades out at each end, so the scene never ends in a hard edge. */
const EDGE_COLS = 14;
const TAU = Math.PI * 2;

/** How fast each layer scrolls relative to the ground. Far layers move less: that is the parallax. */
const PARALLAX = { stars: 0.05, farHills: 0.22, nearHills: 0.5, ground: 1 } as const;

const FAR_BASE = 10;
const FAR_MIN = 8;
const NEAR_BASE = 11;
const GROUND_LINE = GROUND_ROW + 1;
const SPRIG_SPACING = 24;
const STAR_ONE_IN = 9;
const STAR_ROWS = 6;

/** 0 at the very ends of the strip, 1 from EDGE_COLS in. */
export function edgeFade(c: number): number {
  const u = Math.min(1, Math.min(c, SCENE_COLS - 1 - c) / EDGE_COLS);
  return u * u * (3 - 2 * u);
}

const smooth = (u: number): number => 0.5 - 0.5 * Math.cos(TAU * u);

const FLOWER = [".#.", "###", ".#.", ".#."] as const;
const SPRIG = ["#.#", ".#.", ".#."] as const;

function stars(offset: number, t: number, emit: Emit): void {
  for (let c = 0; c < SCENE_COLS; c++) {
    const h = hash((c + offset) * 31 + 7);
    if (h % STAR_ONE_IN !== 0) continue;
    const period = 2 + ((h >>> 4) % 3);
    const phase = ((h >>> 12) % 100) / 100;
    emit(c, (h >>> 8) % STAR_ROWS, edgeFade(c) * (0.2 + 0.5 * smooth(t / period + phase)), "neutral");
  }
}

function hills(farOffset: number, nearOffset: number, emit: Emit): void {
  for (let c = 0; c < SCENE_COLS; c++) {
    const fade = edgeFade(c);
    const far = c + farOffset;
    const farHeight = Math.round(1 + Math.sin(far * 0.045) * 0.9 + Math.sin(far * 0.11 + 1.3) * 0.6);
    emit(c, Math.max(FAR_MIN, FAR_BASE - farHeight), 0.26 * fade, "dim");

    const near = c + nearOffset;
    const nearHeight = Math.min(1, Math.max(0, Math.round(0.6 + Math.sin(near * 0.06 + 2) * 0.7 + Math.sin(near * 0.17) * 0.4)));
    const ridge = NEAR_BASE - nearHeight;
    emit(c, ridge, 0.42 * fade, "dim");
    for (let r = ridge + 1; r < GROUND_ROW; r++) if ((near + r) % 2 === 0) emit(c, r, 0.1 * fade, "dim");
  }
}

function ground(emit: Emit): void {
  for (let c = 0; c < SCENE_COLS; c += 2) emit(c, GROUND_LINE, 0.4 * edgeFade(c), "dim");
}

function sprigs(offset: number, emit: Emit): void {
  const first = Math.floor(offset / SPRIG_SPACING) - 1;
  const last = Math.floor((offset + SCENE_COLS) / SPRIG_SPACING) + 1;
  for (let s = first; s <= last; s++) {
    const art = hash(s) % 2 === 0 ? FLOWER : SPRIG;
    const left = s * SPRIG_SPACING + (hash(s * 5 + 1) % 12) - offset - 1;
    const top = GROUND_ROW - art.length + 1;
    art.forEach((row, r) => {
      [...row].forEach((ch, i) => {
        const c = left + i;
        if (ch === "#" && c >= 0 && c < SCENE_COLS) emit(c, top + r, 0.85 * edgeFade(c), "success");
      });
    });
  }
}

/**
 * Cells of the landscape: twinkling stars, two parallax rows of dotted hills, a dotted ground line and
 * small plants. `scroll` is how far the world has moved in cells; `t` drives the twinkle.
 */
export function landscape(scroll: number, t: number, emit: Emit): void {
  stars(Math.floor(scroll * PARALLAX.stars), t, emit);
  hills(Math.floor(scroll * PARALLAX.farHills), Math.floor(scroll * PARALLAX.nearHills), emit);
  ground(emit);
  sprigs(Math.floor(scroll * PARALLAX.ground), emit);
}

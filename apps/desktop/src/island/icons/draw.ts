import type { IconStyle } from "../protocol";
import { ICONS, LATTICE, type IconKind } from "./frames";
import type { Palette } from "./palette";

/** One icon being drawn: which state, how long it has been showing, and how visible it is (0..1). */
export interface Layer {
  readonly kind: IconKind;
  readonly t: number;
  readonly weight: number;
}

/** Proportions inside one lattice cell, in cell units. */
const DOT_RADIUS = 0.46;
const BLOCK_SIDE = 0.8;
const BLOCK_RADIUS = 0.2;
const STRIPE_WIDTH = 0.92;
const STRIPE_HEIGHT = 0.42;
/** Dim cells shrink a little so brightness reads as both opacity and size. */
const SIZE_FLOOR = 0.7;
/** Unlit lattice dots sit well back so the lit shape stays the first thing the eye finds. */
const GHOST_ALPHA = 0.28;
/** Cells dimmer than this are not worth a draw call. */
const VISIBLE = 0.03;

export function drawShape(ctx: CanvasRenderingContext2D, style: IconStyle, cx: number, cy: number, cell: number, v: number): void {
  const size = SIZE_FLOOR + (1 - SIZE_FLOOR) * v;
  ctx.beginPath();
  if (style === "dots") {
    ctx.arc(cx, cy, cell * DOT_RADIUS * size, 0, Math.PI * 2);
  } else if (style === "blocks") {
    const side = cell * BLOCK_SIDE * size;
    ctx.roundRect(cx - side / 2, cy - side / 2, side, side, cell * BLOCK_RADIUS);
  } else {
    const w = cell * STRIPE_WIDTH * size;
    const h = cell * STRIPE_HEIGHT * size;
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
  }
  ctx.fill();
}

/** Paints the lattice for every layer. `cell` is the pitch in canvas pixels. */
export function drawIcon(ctx: CanvasRenderingContext2D, layers: readonly Layer[], style: IconStyle, palette: Palette, cell: number): void {
  const extent = cell * LATTICE;
  ctx.clearRect(0, 0, extent, extent);

  if (style === "dots") {
    ctx.globalAlpha = GHOST_ALPHA;
    ctx.fillStyle = palette.off;
    for (let r = 0; r < LATTICE; r++) for (let c = 0; c < LATTICE; c++) drawShape(ctx, style, (c + 0.5) * cell, (r + 0.5) * cell, cell, 1);
  }

  for (const layer of layers) {
    if (layer.weight <= 0) continue;
    const spec = ICONS[layer.kind];
    const lead = spec.lead(layer.t);
    for (let r = 0; r < LATTICE; r++) {
      for (let c = 0; c < LATTICE; c++) {
        const isLead = lead !== null && lead.c === c && lead.r === r;
        const v = isLead ? lead.v : spec.cell(layer.t, c, r);
        if (v < VISIBLE) continue;
        ctx.globalAlpha = Math.min(1, v) * layer.weight;
        ctx.fillStyle = isLead ? palette.lead : palette.tones[spec.tone];
        drawShape(ctx, style, (c + 0.5) * cell, (r + 0.5) * cell, cell, Math.min(1, v));
      }
    }
  }
  ctx.globalAlpha = 1;
}

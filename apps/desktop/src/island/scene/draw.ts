import { drawShape } from "../icons/draw";
import type { Palette } from "../icons/palette";
import type { IconStyle, Phase } from "../protocol";
import { creatureCells } from "./creature";
import { landscape } from "./landscape";
import { GROUND_ROW, SCENE_COLS, SCENE_ROWS, SPRITE_FEET, SPRITE_WIDTH, type Emit } from "./layout";
import type { SceneState } from "./motion";

/** Cells dimmer than this are not worth a draw call. */
const VISIBLE = 0.03;

/** One pose of the beetle being drawn: which phase, how long it has lasted and how visible it is (0..1). */
export interface PoseLayer {
  readonly phase: Phase;
  readonly tp: number;
  readonly weight: number;
}

export interface SceneFrame {
  readonly state: SceneState;
  /** Free-running seconds, for twinkle and ambient motion. */
  readonly t: number;
  readonly poses: readonly PoseLayer[];
}

/** The scene is built from small dots; stripes only make sense for the icon, so the scene keeps its dots. */
function sceneShape(style: IconStyle): IconStyle {
  return style === "blocks" ? "blocks" : "dots";
}

/** Paints one frame of landscape and beetle. `cell` is the lattice pitch in canvas pixels. */
export function drawScene(ctx: CanvasRenderingContext2D, frame: SceneFrame, style: IconStyle, palette: Palette, cell: number): void {
  ctx.clearRect(0, 0, SCENE_COLS * cell, SCENE_ROWS * cell);
  const shape = sceneShape(style);

  const paint = (weight: number, column: (c: number) => number, row: (r: number) => number): Emit => (c, r, v, tone) => {
    const col = column(c);
    const rw = row(r);
    const alpha = Math.min(1, v) * weight;
    if (alpha < VISIBLE || col < 0 || col >= SCENE_COLS || rw < 0 || rw >= SCENE_ROWS) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = palette.tones[tone];
    drawShape(ctx, shape, (col + 0.5) * cell, (rw + 0.5) * cell, cell, Math.min(1, v));
  };

  const identity = (n: number): number => n;
  landscape(frame.state.scroll, frame.t, paint(1, identity, identity));

  const left = Math.round(frame.state.x);
  const facing = frame.state.dir;
  const column = (c: number): number => (facing > 0 ? left + c : left + SPRITE_WIDTH - 1 - c);
  const row = (r: number): number => GROUND_ROW - SPRITE_FEET + r;
  for (const pose of frame.poses) {
    if (pose.weight <= 0) continue;
    creatureCells(pose.phase, pose.tp, frame.t, frame.state.gait, frame.state.speed, paint(pose.weight, column, row));
  }
  ctx.globalAlpha = 1;
}

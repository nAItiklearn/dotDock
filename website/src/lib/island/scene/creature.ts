// Origin: copied from apps/desktop/src/island/scene/creature.ts so the site shows the real island. Keep in sync by hand.
import type { Tone } from "../icons/frames";
import type { Phase } from "../protocol";
import type { Emit } from "./layout";

/**
 * The beetle, drawn in sprite-local cells: column 0 is the tail, the head faces +x, row 0 is the top of its
 * antennae and row 7 is where its feet rest. Poses may reach outside that box (a thought bubble, a spark).
 * Everything is a pure function of time, so poses are unit-testable and cross-fade without a sprite sheet.
 */

const TAU = Math.PI * 2;
const frac = (x: number): number => x - Math.floor(x);
const smooth = (u: number): number => 0.5 - 0.5 * Math.cos(TAU * u);

/** Characters in the art strings: # full, + dimmer (wing seam), o eye. */
const SEAM = 0.55;

function stamp(emit: Emit, art: readonly string[], ox: number, oy: number, tone: Tone, level = 1, eye?: { tone: Tone; v: number }): void {
  art.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === "#") emit(ox + c, oy + r, level, tone);
      else if (ch === "+") emit(ox + c, oy + r, SEAM * level, tone);
      else if (ch === "o" || ch === "x") emit(ox + c, oy + r, eye ? eye.v : level, eye ? eye.tone : tone);
    });
  });
}

const SHELL = ["..##+##.....", ".###+###....", ".###+###....", ".###+###...."] as const;
const SHELL_FLIPPED = [".###+###....", ".###+###....", ".###+###....", "..##+##....."] as const;
const HEAD = ["##.", "#o#", "##."] as const;
const HEAD_FLIPPED = ["##.", "#x#", "##."] as const;
const CURL = ["..###..", ".#####.", ".#####.", "..###.."] as const;
const Z = ["###", ".#.", "###"] as const;

const SHELL_TOP = 2;
const HEAD_COL = 8;
const HEAD_TOP = 3;
const LEG_COLS = [2, 4, 6] as const;
const LEG_TOP = 6;
const FOOT = 7;

type Antennae = "rest" | "twitch" | "up" | "down" | "back" | "left" | "upLeft" | "upRight" | "right";

/** Each antenna as cells relative to the top of the head (negative rows are above it). */
const ANTENNAE: Readonly<Record<Antennae, readonly (readonly [number, number])[]>> = {
  rest: [[0, -1], [0, -2], [1, -1], [2, -2]],
  twitch: [[0, -1], [-1, -2], [1, -1], [2, -2]],
  up: [[0, -1], [0, -2], [1, -1], [1, -2]],
  down: [[1, -1], [2, -1], [3, 0]],
  back: [[0, -1], [-1, -1], [1, -1], [0, -1]],
  left: [[0, -1], [-1, -2], [-2, -2], [1, -1]],
  upLeft: [[0, -1], [0, -2], [-1, -3], [1, -1]],
  upRight: [[0, -1], [1, -2], [2, -3], [1, -1]],
  right: [[0, -1], [1, -1], [2, -2], [3, -2]],
};
const SWEEP: readonly Antennae[] = ["left", "upLeft", "up", "upRight", "right", "upRight", "up", "upLeft"];

function antennae(emit: Emit, headTop: number, kind: Antennae, tone: Tone): void {
  for (const [dc, dr] of ANTENNAE[kind]) emit(HEAD_COL + dc, headTop + dr, 0.8, tone);
}

type Legs = "stand" | "walk" | "blur" | "tucked";

function legs(emit: Emit, mode: Legs, gait: number, dy: number, tone: Tone): void {
  const down = (c: number, v: number): void => {
    emit(c, LEG_TOP + dy, v, tone);
    emit(c, FOOT + dy, v, tone);
  };
  const lifted = (c: number, v: number): void => {
    emit(c, LEG_TOP + dy, v, tone);
    emit(c + 1, LEG_TOP + dy, v, tone);
  };
  const phase = frac(gait);
  for (const [i, c] of LEG_COLS.entries()) {
    const grounded = i === 1 ? phase >= 0.5 : phase < 0.5;
    if (mode === "stand") down(c, 1);
    else if (mode === "tucked") emit(c, LEG_TOP + dy, 1, tone);
    else if (mode === "walk") (grounded ? down : lifted)(c, 1);
    else {
      down(c, 0.5);
      lifted(c, 0.5);
    }
  }
}

interface Body {
  readonly dy: number;
  readonly headDy: number;
  readonly tone: Tone;
  readonly eye: { readonly tone: Tone; readonly v: number };
}

function body(emit: Emit, b: Body): void {
  stamp(emit, SHELL, 0, SHELL_TOP + b.dy, b.tone);
  stamp(emit, HEAD, HEAD_COL, HEAD_TOP + b.dy + b.headDy, b.tone, 1, b.eye);
}

const LEAD: Body["eye"] = { tone: "accent", v: 1 };
const sitting = (patch: Partial<Body> = {}): Body => ({ dy: 0, headDy: 0, tone: "neutral", eye: LEAD, ...patch });

const HOP_SECONDS = 0.36;
const HOP_GAP = 0.08;
const HOP_HEIGHT = 3;
/** Seconds after which both hops are over and the beetle sits. */
export const DONE_SETTLE = 2 * HOP_SECONDS + HOP_GAP;

function hopOffset(tp: number): number {
  const local = tp < HOP_SECONDS ? tp : tp - HOP_SECONDS - HOP_GAP;
  const hopping = tp < HOP_SECONDS || (tp >= HOP_SECONDS + HOP_GAP && tp < DONE_SETTLE);
  return hopping ? -Math.round(HOP_HEIGHT * Math.sin((Math.PI * local) / HOP_SECONDS)) : 0;
}

/**
 * Cells of the beetle for a phase. `tp` is seconds since the phase began (for one-shot motion such as the
 * hops), `t` a free-running clock (for ambient motion), `gait` the walk cycle count and `speed` cells per second.
 */
export function creatureCells(phase: Phase, tp: number, t: number, gait: number, speed: number, emit: Emit): void {
  switch (phase) {
    case "thinking": {
      body(emit, sitting());
      antennae(emit, HEAD_TOP, frac(t / 1.6) < 0.12 ? "twitch" : "rest", "neutral");
      legs(emit, "stand", 0, 0, "neutral");
      for (let i = 0; i < 3; i++) {
        const u = frac(t / 1.3 - i * 0.28);
        emit(2 + 2 * i, Math.round(1 - 3 * u), Math.sin(Math.PI * u), "neutral");
      }
      return;
    }
    case "reading": {
      body(emit, sitting({ headDy: 1 }));
      antennae(emit, HEAD_TOP + 1, "down", "neutral");
      legs(emit, speed > 1 ? "walk" : "stand", gait, 0, "neutral");
      return;
    }
    case "searching": {
      body(emit, sitting());
      antennae(emit, HEAD_TOP, SWEEP[Math.floor(t * 3.2) % SWEEP.length] ?? "up", "neutral");
      legs(emit, "stand", 0, 0, "neutral");
      return;
    }
    case "editing": {
      const tapping = Math.floor(t * 4) % 2 === 1;
      body(emit, sitting({ headDy: tapping ? 1 : 0 }));
      antennae(emit, HEAD_TOP + (tapping ? 1 : 0), "rest", "neutral");
      legs(emit, "stand", 0, 0, "neutral");
      if (tapping) {
        emit(11, FOOT, 0.7, "neutral");
        emit(12, FOOT - 1, 0.4, "neutral");
      }
      return;
    }
    case "running": {
      const bounce = Math.floor(t * 8) % 2 === 1 ? -1 : 0;
      body(emit, sitting({ dy: bounce }));
      antennae(emit, HEAD_TOP + bounce, "back", "neutral");
      legs(emit, "blur", gait, bounce, "neutral");
      const slide = Math.floor(t * 14) % 3;
      for (let i = 0; i < 3; i++) {
        emit(-2 - i - slide, 3, 0.4 - 0.1 * i, "neutral");
        emit(-3 - i - slide, 5, 0.3 - 0.08 * i, "neutral");
      }
      return;
    }
    case "waiting": {
      body(emit, sitting({ headDy: -1 }));
      antennae(emit, HEAD_TOP - 1, "up", "neutral");
      legs(emit, "stand", 0, 0, "neutral");
      const v = frac(t / 1.2) < 0.7 ? 1 : 0.35;
      emit(11, -2, v, "accent");
      emit(11, -1, v, "accent");
      emit(11, 1, v, "accent");
      return;
    }
    case "done": {
      const dy = hopOffset(tp);
      body(emit, sitting({ dy }));
      antennae(emit, HEAD_TOP + dy, dy < 0 ? "up" : "rest", "neutral");
      legs(emit, dy < 0 ? "tucked" : "stand", 0, dy, "neutral");
      if (tp >= DONE_SETTLE) {
        const v = 0.55 + 0.45 * smooth(t / 0.9);
        for (const [c, r] of [[12, -1], [11, -1], [13, -1], [12, -2], [12, 0]] as const) emit(c, r, v, "success");
      }
      return;
    }
    case "paused": {
      const stretch = frac(t / 3.2) >= 0.45 && frac(t / 3.2) < 0.75;
      body(emit, sitting({ headDy: stretch ? 1 : 0 }));
      antennae(emit, HEAD_TOP + (stretch ? 1 : 0), stretch ? "down" : "rest", "neutral");
      legs(emit, "stand", 0, 0, "neutral");
      if (stretch) {
        emit(9, FOOT, 0.6, "neutral");
        emit(10, FOOT, 0.6, "neutral");
        emit(11, FOOT, 0.4, "neutral");
      }
      return;
    }
    case "limit": {
      body(emit, { dy: 1, headDy: 1, tone: "dim", eye: { tone: "danger", v: frac(t / 1.6) < 0.5 ? 1 : 0.25 } });
      antennae(emit, HEAD_TOP + 2, "down", "dim");
      for (const c of [1, 3, 5, 7]) emit(c, FOOT, 0.6, "dim");
      return;
    }
    case "error": {
      stamp(emit, SHELL_FLIPPED, 0, SHELL_TOP + 2, "dim", 0.9);
      stamp(emit, HEAD_FLIPPED, HEAD_COL, HEAD_TOP + 2, "dim", 0.9, { tone: "danger", v: 1 });
      const flip = Math.floor(t * 7) % 2;
      LEG_COLS.forEach((c, i) => {
        const lean = (i + flip) % 2 === 0 ? -1 : 1;
        emit(c, 3, 0.9, "danger");
        emit(c + lean, 2, 0.9, "danger");
      });
      return;
    }
    case "stopped":
    case "idle": {
      stamp(emit, CURL, 3, 4, "dim", 0.8);
      for (let i = 0; i < 2; i++) {
        const u = frac(t / 2.4 - i * 0.5);
        stamp(emit, Z, 9 + Math.round(2 * u), 3 - Math.round(4 * u), "dim", Math.sin(Math.PI * u) * 0.8);
      }
      return;
    }
  }
}

/** Time into a phase and free-running time at which each pose is most readable; used when motion is reduced. */
export const STATIC_POSE: Readonly<Record<Phase, { readonly tp: number; readonly t: number }>> = {
  thinking: { tp: 1, t: 0.6 },
  reading: { tp: 1, t: 0.2 },
  searching: { tp: 1, t: 0.35 },
  editing: { tp: 1, t: 0.1 },
  running: { tp: 1, t: 0.05 },
  waiting: { tp: 1, t: 0.3 },
  done: { tp: DONE_SETTLE + 0.5, t: 1 },
  paused: { tp: 1, t: 0.3 },
  limit: { tp: 1, t: 0.2 },
  error: { tp: 1, t: 0.05 },
  stopped: { tp: 1, t: 0.5 },
  idle: { tp: 1, t: 0.5 },
};

import type { Phase } from "../protocol";
import { SPRITE_WIDTH, WALK_MAX, WALK_MIN } from "./layout";

/**
 * Where the beetle is and how the world moves under it. The state is advanced a frame at a time and
 * every speed eases toward its target, so changing phase never teleports or snaps anything.
 */
export interface SceneState {
  /** Left edge of the beetle's sprite box, in lattice columns. */
  readonly x: number;
  readonly dir: 1 | -1;
  /** Walking speed in columns per second, never negative. */
  readonly speed: number;
  /** How far the landscape has scrolled, in columns. */
  readonly scroll: number;
  /** How fast it is scrolling now, in columns per second; negative scrolls the other way. */
  readonly scrollSpeed: number;
  /** Walk cycles completed, which drives the legs. */
  readonly gait: number;
}

export const INITIAL_SCENE: SceneState = { x: 28, dir: 1, speed: 0, scroll: 0, scrollSpeed: 0, gait: 0 };

const STROLL_SPEED = 9;
const SPRINT_APPROACH = 30;
const SPRINT_SCROLL = 70;
/** The spot where a sprinting beetle holds while the landscape rushes past. */
const SPRINT_X = 40;
const WALK_ACCEL = 40;
/** Closer than this to its spot the beetle counts as arrived; further past it than this, it turns back. */
const ARRIVED_WITHIN = 2;
/** Slows the run-up so braking always fits inside the acceleration limit and the beetle never overshoots. */
const BRAKING_MARGIN = 0.8;
const SCROLL_ACCEL = 140;
/** Slowest walking speed at which the beetle may still turn around. */
const TURN_BELOW = 0.5;
const EDGE_MARGIN = 2;
const COLS_PER_CYCLE = 6;
/** Legs cannot be shown faster than the frame rate can carry. */
const MAX_CYCLES_PER_SECOND = 6;
/** Where a new session's beetle stops after walking in from beyond the left edge. */
const ENTER_TO = WALK_MIN + 10;
/** A brisk walk in, a little quicker than a stroll, so it is over in about two seconds. */
export const ENTER_SPEED = 14;

/** A new session: the beetle starts just outside the strip, already strolling in. */
export const ENTERING_SCENE: SceneState = { x: -SPRITE_WIDTH, dir: 1, speed: ENTER_SPEED, scroll: 0, scrollSpeed: 0, gait: 0 };

/** True while the beetle is still walking in; it then looks like a stroll whatever the agent does. */
export function isEntering(state: SceneState): boolean {
  return state.x < ENTER_TO - ARRIVED_WITHIN;
}

/** A long pause (hidden window, sleeping laptop) must not fling the beetle across the strip. */
const MAX_STEP = 0.1;

function approach(value: number, target: number, step: number): number {
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
}

/** The world rushes backwards past a sprinting beetle, so it scrolls against the way the beetle faces. */
function scrollTarget(phase: Phase, dir: 1 | -1): number {
  return phase === "running" ? dir * SPRINT_SCROLL : 0;
}

/** Advances the scene by `dt` seconds while the agent is in `phase`. */
export function stepScene(state: SceneState, phase: Phase, dtSeconds: number): SceneState {
  const dt = Math.min(MAX_STEP, Math.max(0, dtSeconds));
  if (isEntering(state)) {
    const ahead = ENTER_TO - state.x;
    const target = Math.min(ENTER_SPEED, Math.sqrt(2 * WALK_ACCEL * BRAKING_MARGIN * ahead));
    const speed = approach(state.speed, target, WALK_ACCEL * dt);
    const cycles = Math.min(MAX_CYCLES_PER_SECOND, speed / COLS_PER_CYCLE);
    return { ...state, dir: 1, speed, x: Math.min(ENTER_TO, state.x + speed * dt), gait: state.gait + cycles * dt };
  }
  let want = state.dir;
  let target = 0;
  if (phase === "reading") {
    target = STROLL_SPEED;
    if (state.x >= WALK_MAX - EDGE_MARGIN) want = -1;
    else if (state.x <= WALK_MIN + EDGE_MARGIN) want = 1;
  } else if (phase === "running") {
    const gap = SPRINT_X - state.x;
    const ahead = state.dir * gap;
    if (ahead < -ARRIVED_WITHIN) want = state.dir === 1 ? -1 : 1;
    else if (ahead >= ARRIVED_WITHIN) target = Math.min(SPRINT_APPROACH, Math.sqrt(2 * WALK_ACCEL * BRAKING_MARGIN * ahead));
  }
  if (want !== state.dir) target = 0;

  const speed = approach(state.speed, target, WALK_ACCEL * dt);
  const dir = want !== state.dir && speed < TURN_BELOW ? want : state.dir;
  const x = Math.min(WALK_MAX, Math.max(WALK_MIN, state.x + dir * speed * dt));
  const scrollSpeed = approach(state.scrollSpeed, scrollTarget(phase, state.dir), SCROLL_ACCEL * dt);
  const cycles = Math.min(MAX_CYCLES_PER_SECOND, (speed + Math.abs(scrollSpeed)) / COLS_PER_CYCLE);
  return { x, dir, speed, scroll: state.scroll + scrollSpeed * dt, scrollSpeed, gait: state.gait + cycles * dt };
}

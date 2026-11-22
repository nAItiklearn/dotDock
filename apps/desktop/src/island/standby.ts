/**
 * The standby dot breathes in a few discrete levels instead of a CSS animation. A CSS animation, even a stepped
 * one, makes the compositor produce a frame on every refresh for as long as the island sits in standby (about one
 * percent of the machine on the test laptop); a level that changes a handful of times per breath costs a frame
 * per change and nothing in between. The dot is on the 7 by 7 lattice's grid of light levels anyway, so stepping
 * fits the look.
 */

/** One breath, in milliseconds, and how many light levels it passes through. */
export const BREATH_MS = 3200;
export const BREATH_STEPS = 8;
/** Opacity of the dot at the bottom and the top of a breath. */
export const BREATH_LOW = 0.3;
export const BREATH_HIGH = 1;
/** Time between two levels. */
export const BREATH_STEP_MS = BREATH_MS / BREATH_STEPS;

/** Opacity at a step of the breath: low at step 0, high halfway, eased like an inhale and exhale. */
export function breathLevel(step: number): number {
  const phase = (((step % BREATH_STEPS) + BREATH_STEPS) % BREATH_STEPS) / BREATH_STEPS;
  const lift = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
  return +(BREATH_LOW + (BREATH_HIGH - BREATH_LOW) * lift).toFixed(3);
}

export interface Breather {
  /** Starts the breath from its lowest level, or holds the dot at full light when it must not move. */
  readonly start: (move: boolean) => void;
  readonly stop: () => void;
}

/** Drives one dot's breath through `show`, with one timer per level and none while the dot holds still. */
export function createBreather(show: (opacity: number) => void): Breather {
  let step = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = (): void => {
    clearTimeout(timer);
    timer = undefined;
  };
  const next = (): void => {
    step += 1;
    show(breathLevel(step));
    timer = setTimeout(next, BREATH_STEP_MS);
  };
  const start = (move: boolean): void => {
    stop();
    if (!move) {
      show(BREATH_HIGH);
      return;
    }
    step = 0;
    show(breathLevel(step));
    timer = setTimeout(next, BREATH_STEP_MS);
  };
  return { start, stop };
}

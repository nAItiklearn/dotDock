/**
 * Critically damped springs. They reach their target as fast as a spring can without overshooting, which is
 * the dock's rule for every settle (the island's plate, by contrast, is allowed a hair of overshoot).
 */
export interface SpringState {
  x: number;
  v: number;
}

/** Time for a critically damped spring to get within 2 % of its target, in units of 1 / omega. */
const SETTLE_FACTOR = 5.83;

/** Natural frequency (rad/s) of a critically damped spring that settles in `ms`. */
export function omegaForSettle(ms: number): number {
  return SETTLE_FACTOR / (ms / 1000);
}

/** Advances the spring by `dt` seconds. The closed form is exact, so any frame length is stable. */
export function stepCritical(state: SpringState, target: number, omega: number, dt: number): void {
  const offset = state.x - target;
  const decay = Math.exp(-omega * dt);
  const lever = state.v + omega * offset;
  state.x = target + (offset + lever * dt) * decay;
  state.v = (state.v - omega * lever * dt) * decay;
}

/** True once the spring is close enough to rest that stepping it further would not change a pixel. */
export function isSettled(state: SpringState, target: number, epsilon: number): boolean {
  return Math.abs(state.x - target) < epsilon && Math.abs(state.v) < epsilon;
}

/** Puts the spring at rest on `value`. */
export function rest(state: SpringState, value: number): void {
  state.x = value;
  state.v = 0;
}

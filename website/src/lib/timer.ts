/** The focus timer: a 25-minute countdown whose minutes show as a row of dots that go dark as time passes. */
export const TIMER_MINUTES = 25;
export const TIMER_SECONDS = TIMER_MINUTES * 60;

/** How many minute dots are still lit with `remaining` seconds left: a started minute counts as left. */
export function minutesLit(remaining: number): number {
  const clamped = Math.min(TIMER_SECONDS, Math.max(0, remaining));
  return Math.ceil(clamped / 60);
}

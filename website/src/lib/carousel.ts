/** The island carousel's rules, kept apart from the DOM so they can be tested (scripts/carousel.ts uses them). */

/** Time each slide stays before the carousel moves on by itself, in ms. */
export const ADVANCE_MS = 4200;

/** The slide after `index`, wrapping back to the first after the last. */
export function nextSlide(index: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + 1) % count) + count) % count;
}

/** The slide whose left edge is nearest the track's scroll position. */
export function nearestSlide(scrollLeft: number, offsets: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < offsets.length; i++) {
    if (Math.abs((offsets[i] ?? 0) - scrollLeft) < Math.abs((offsets[best] ?? 0) - scrollLeft)) best = i;
  }
  return best;
}

/** It advances only when the reader wants it to and can see it. */
export function shouldAdvance(state: { playing: boolean; visible: boolean; hovered: boolean; focused: boolean }): boolean {
  return state.playing && state.visible && !state.hovered && !state.focused;
}

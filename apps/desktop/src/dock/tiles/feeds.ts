import { useEffect } from "react";
import { create } from "zustand";
import { tilesBackend } from "./backend";
import { FeedHub, normalise } from "./hub";
import type { FeedName, TileFeeds } from "./ui-types";

interface FeedStore {
  /** The last value of each feed that has been delivered; a feed missing here has not arrived yet. */
  readonly feeds: Partial<TileFeeds>;
  readonly merge: (changes: Partial<TileFeeds>) => void;
}

export const useFeedStore = create<FeedStore>((set) => ({
  feeds: {},
  merge: (changes) => set((s) => ({ feeds: { ...s.feeds, ...normalise(changes) } })),
}));

/**
 * Collects the core's deliveries and hands them to the store once per frame, so several feeds changing in one frame
 * cost one render of the tiles that show them, and the dock never draws a frame twice for one tick of data. A
 * feed's own object is kept when it did not change, so a tile whose feed is untouched does not render at all.
 */
export function frameBatcher(apply: (changes: Partial<TileFeeds>) => void, schedule: (flush: () => void) => void): (changes: Partial<TileFeeds>) => void {
  let pending: Partial<TileFeeds> | null = null;
  return (changes) => {
    const first = pending === null;
    pending = { ...pending, ...changes };
    if (!first) return;
    schedule(() => {
      const batch = pending;
      pending = null;
      if (batch) apply(batch);
    });
  };
}

const nextFrame = (flush: () => void): void => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush);
  else queueMicrotask(flush);
};

export const feedHub = new FeedHub(
  tilesBackend,
  frameBatcher((changes) => useFeedStore.getState().merge(changes), nextFrame),
);

/** The latest value of a feed, or null before the core has delivered it. Reading it keeps the core feeding it. */
export function useFeed<K extends FeedName>(name: K): TileFeeds[K] | null {
  useEffect(() => feedHub.acquire(name), [name]);
  return (useFeedStore((s) => s.feeds[name]) as TileFeeds[K] | undefined) ?? null;
}

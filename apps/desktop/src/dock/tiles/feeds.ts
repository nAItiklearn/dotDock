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

export const feedHub = new FeedHub(tilesBackend, (changes) => useFeedStore.getState().merge(changes));

/** The latest value of a feed, or null before the core has delivered it. Reading it keeps the core feeding it. */
export function useFeed<K extends FeedName>(name: K): TileFeeds[K] | null {
  useEffect(() => feedHub.acquire(name), [name]);
  return (useFeedStore((s) => s.feeds[name]) as TileFeeds[K] | undefined) ?? null;
}

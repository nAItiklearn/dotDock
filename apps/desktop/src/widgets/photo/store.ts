import { create } from "zustand";
import { persist } from "zustand/middleware";
import { persistOptions, syncAcrossWindows } from "../persist";
import { clampFraming, CENTRED, type Framing } from "./frame";

const NAME = "photos";
const VERSION = 1;

/** Per photo widget: where the photo is framed, and a revision bumped whenever its file changes. */
export interface PhotoEntry {
  readonly framing: Framing;
  readonly rev: number;
}

interface Persisted {
  readonly entries: Readonly<Record<string, PhotoEntry>>;
}

interface PhotoStore extends Persisted {
  /** Records that the widget's file was replaced; other windows reload it when `rev` changes. */
  replaced: (id: string) => void;
  frame: (id: string, framing: Framing) => void;
}

export const EMPTY_ENTRY: PhotoEntry = { framing: CENTRED, rev: 0 };

export const usePhotoStore = create<PhotoStore>()(
  persist(
    (set) => ({
      entries: {},
      replaced: (id) =>
        set((s) => ({ entries: { ...s.entries, [id]: { framing: CENTRED, rev: (s.entries[id]?.rev ?? 0) + 1 } } })),
      frame: (id, framing) =>
        set((s) => ({ entries: { ...s.entries, [id]: { framing: clampFraming(framing), rev: s.entries[id]?.rev ?? 0 } } })),
    }),
    persistOptions<PhotoStore, Persisted>({
      name: NAME,
      version: VERSION,
      partialize: (s) => ({ entries: s.entries }),
    }),
  ),
);

syncAcrossWindows(NAME, usePhotoStore);

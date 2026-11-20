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

/**
 * Entries read back from storage, made safe: a hand-edited or damaged value becomes a centred,
 * unzoomed photo instead of NaN in the layout maths. Entries that are not objects are dropped.
 */
export function sanitizeEntries(raw: unknown): Readonly<Record<string, PhotoEntry>> {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, PhotoEntry> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as { framing?: Partial<Framing> | null; rev?: unknown };
    const rev = typeof entry.rev === "number" && Number.isInteger(entry.rev) && entry.rev >= 0 ? entry.rev : 0;
    out[id] = { framing: clampFraming({ ...CENTRED, ...entry.framing }), rev };
  }
  return out;
}

export const usePhotoStore = create<PhotoStore>()(
  persist(
    (set) => ({
      entries: {},
      replaced: (id) =>
        set((s) => ({ entries: { ...s.entries, [id]: { framing: CENTRED, rev: (s.entries[id]?.rev ?? 0) + 1 } } })),
      frame: (id, framing) =>
        set((s) => ({ entries: { ...s.entries, [id]: { framing: clampFraming(framing), rev: s.entries[id]?.rev ?? 0 } } })),
    }),
    {
      ...persistOptions<PhotoStore, Persisted>({
        name: NAME,
        version: VERSION,
        partialize: (s) => ({ entries: s.entries }),
      }),
      merge: (stored, current) => ({ ...current, entries: sanitizeEntries((stored as Partial<Persisted> | undefined)?.entries) }),
    },
  ),
);

syncAcrossWindows(NAME, usePhotoStore);

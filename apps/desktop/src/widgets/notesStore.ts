import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  clampNoteText,
  createNote,
  MAX_NOTES,
  nextColor,
  orderedNotes,
  type Note,
  type NoteColor,
} from "./notesModel";
import { persistOptions, syncAcrossWindows } from "./persist";

const NAME = "notes";
const VERSION = 1;

interface Persisted {
  readonly notes: readonly Note[];
  readonly activeId: string | null;
}

interface NotesStore extends Persisted {
  /** Adds an empty note and selects it. */
  add: () => void;
  select: (id: string) => void;
  edit: (id: string, title: string, body: string) => void;
  togglePin: (id: string) => void;
  cycleColor: (id: string) => void;
  remove: (id: string) => void;
}

export const useNotesStore = create<NotesStore>()(
  persist(
    (set) => ({
      notes: [],
      activeId: null,
      add: () =>
        set((s) => {
          if (s.notes.length >= MAX_NOTES) return s;
          const note = createNote(crypto.randomUUID(), s.notes.length === 0 ? "plain" : "stone");
          return { notes: [...s.notes, note], activeId: note.id };
        }),
      select: (id) => set({ activeId: id }),
      edit: (id, title, body) =>
        set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...clampNoteText(title, body) } : n)) })),
      togglePin: (id) =>
        set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n)) })),
      cycleColor: (id) =>
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, color: nextColor(n.color) } : n)),
        })),
      remove: (id) =>
        set((s) => {
          const notes = s.notes.filter((n) => n.id !== id);
          const activeId = s.activeId === id ? (orderedNotes(notes)[0]?.id ?? null) : s.activeId;
          return { notes, activeId };
        }),
    }),
    persistOptions<NotesStore, Persisted>({
      name: NAME,
      version: VERSION,
      partialize: (s) => ({ notes: s.notes, activeId: s.activeId }),
    }),
  ),
);

syncAcrossWindows(NAME, useNotesStore);

export type { Note, NoteColor };

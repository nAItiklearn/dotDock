import { create } from "zustand";
import { persist } from "zustand/middleware";
import { persistOptions, syncAcrossWindows } from "./persist";
import {
  addItem,
  clearDone,
  removeItem,
  reorderOpen,
  setDue,
  toggleItem,
  type TodoItem,
} from "./todoModel";

const NAME = "todo";
const VERSION = 1;

interface Persisted {
  readonly items: readonly TodoItem[];
}

interface TodoStore extends Persisted {
  add: (text: string) => void;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  setDue: (id: string, due: string | null) => void;
  /** Positions refer to the open items, in the order shown. */
  reorder: (from: number, to: number) => void;
  clearDone: () => void;
}

export const useTodoStore = create<TodoStore>()(
  persist(
    (set) => ({
      items: [],
      add: (text) => set((s) => ({ items: addItem(s.items, text, crypto.randomUUID()) })),
      toggle: (id) => set((s) => ({ items: toggleItem(s.items, id) })),
      remove: (id) => set((s) => ({ items: removeItem(s.items, id) })),
      setDue: (id, due) => set((s) => ({ items: setDue(s.items, id, due) })),
      reorder: (from, to) => set((s) => ({ items: reorderOpen(s.items, from, to) })),
      clearDone: () => set((s) => ({ items: clearDone(s.items) })),
    }),
    persistOptions<TodoStore, Persisted>({ name: NAME, version: VERSION, partialize: (s) => ({ items: s.items }) }),
  ),
);

syncAcrossWindows(NAME, useTodoStore);

/** Pure list operations for the to-do widget. The store applies them and persists the result. */
export interface TodoItem {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
  /** Local calendar date as YYYY-MM-DD, or null for no due date. */
  readonly due: string | null;
}

export const MAX_ITEMS = 100;
export const MAX_TEXT_LENGTH = 140;

export function addItem(items: readonly TodoItem[], text: string, id: string): readonly TodoItem[] {
  const clean = text.trim().slice(0, MAX_TEXT_LENGTH);
  if (clean === "" || items.length >= MAX_ITEMS) return items;
  return [...items, { id, text: clean, done: false, due: null }];
}

export function toggleItem(items: readonly TodoItem[], id: string): readonly TodoItem[] {
  return items.map((item) => (item.id === id ? { ...item, done: !item.done } : item));
}

export function removeItem(items: readonly TodoItem[], id: string): readonly TodoItem[] {
  return items.filter((item) => item.id !== id);
}

export function setDue(items: readonly TodoItem[], id: string, due: string | null): readonly TodoItem[] {
  return items.map((item) => (item.id === id ? { ...item, due } : item));
}

export function clearDone(items: readonly TodoItem[]): readonly TodoItem[] {
  return items.filter((item) => !item.done);
}

/** Open items in the user's order, then finished ones. This is the order the widget shows. */
export function displayOrder(items: readonly TodoItem[]): readonly TodoItem[] {
  return [...items.filter((i) => !i.done), ...items.filter((i) => i.done)];
}

/** Moves one element, returning a new array. Out-of-range targets are clamped. */
export function moveWithin<T>(list: readonly T[], from: number, to: number): readonly T[] {
  if (from < 0 || from >= list.length) return list;
  const target = Math.min(list.length - 1, Math.max(0, to));
  if (target === from) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return list;
  next.splice(target, 0, moved);
  return next;
}

/**
 * Reorders the open items (positions refer to the open items only). Finished items keep their
 * place at the end, so dragging never has to cross them.
 */
export function reorderOpen(items: readonly TodoItem[], from: number, to: number): readonly TodoItem[] {
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const moved = moveWithin(open, from, to);
  return moved === open ? items : [...moved, ...done];
}

export type DueState = "overdue" | "today" | "upcoming";

/** Parses YYYY-MM-DD as a local date; null if it is not a real calendar date. */
export function parseDue(due: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function formatDue(date: Date): string {
  const p = (n: number): string => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function dueState(due: string | null, today: Date): DueState | null {
  if (due === null) return null;
  const date = parseDue(due);
  if (!date) return null;
  const key = formatDue(today);
  if (due === key) return "today";
  return due < key ? "overdue" : "upcoming";
}

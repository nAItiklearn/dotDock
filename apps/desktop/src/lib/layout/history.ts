/** Undo/redo over immutable snapshots. Snapshots are small (a list of placements), so we store them whole. */
export const HISTORY_LIMIT = 50;

export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Records `next` as a new step. Identical state (same reference) is not a step. A new step drops the redo branch. */
export function pushHistory<T>(history: History<T>, next: T, limit: number = HISTORY_LIMIT): History<T> {
  if (Object.is(next, history.present)) return history;
  const past = [...history.past, history.present];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [] };
}

export function undoHistory<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redoHistory<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0;

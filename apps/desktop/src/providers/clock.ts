import { useSyncExternalStore } from "react";

/**
 * One shared ticker for every time-based widget, aligned to the wall-clock second
 * so all widgets flip on the same frame. Stops when nobody listens.
 */
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleTick(): void {
  const msToNextSecond = 1000 - (Date.now() % 1000);
  timer = setTimeout(() => {
    now = Date.now();
    listeners.forEach((l) => l());
    scheduleTick();
  }, msToNextSecond);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    scheduleTick();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

const getSnapshot = (): number => now;

/** Current time, re-rendering at most once per second. */
export function useNow(): Date {
  return new Date(useSyncExternalStore(subscribe, getSnapshot));
}

/** Re-renders only when the minute changes (cheaper for widgets that ignore seconds). */
export function useMinute(): Date {
  const minute = useSyncExternalStore(subscribe, () => Math.floor(now / 60000));
  return new Date(minute * 60000);
}

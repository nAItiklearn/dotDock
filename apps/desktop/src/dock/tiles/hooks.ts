import { useEffect, useState } from "react";
import { useDockStore } from "../store";

/** The longest a timer may be asked to wait: browsers clamp anything past 2^31 - 1 ms to "now". */
export const MAX_TIMEOUT_MS = 2_147_483_647;

/** False while the core has frozen the dock or the page is hidden: nothing may tick then. */
export function useAwake(): boolean {
  const frozen = useDockStore((s) => s.frozen);
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const update = (): void => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return !frozen && !hidden;
}

/** `Date.now()` refreshed every `everyMs` while `active` and awake, and once more the moment it wakes. */
export function useTicker(everyMs: number, active: boolean): number {
  const awake = useAwake();
  const [now, setNow] = useState(() => Date.now());
  const running = active && awake;
  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [running, everyMs]);
  return now;
}

/**
 * `Date.now()`, refreshed at the one moment `next(now)` names (epoch ms) and nowhere in between; null means nothing
 * is waiting. Used where text changes at known times (a countdown's minute turning), so the dock wakes only then.
 */
export function useBoundary(next: (now: number) => number | null): number {
  const awake = useAwake();
  const [now, setNow] = useState(() => Date.now());
  const at = next(now);
  useEffect(() => {
    if (awake) setNow(Date.now());
  }, [awake]);
  useEffect(() => {
    if (!awake || at === null) return undefined;
    const wait = at - Date.now();
    // Already past: the caller was computing from a stale `now`. Catch up once; its next moment is in the future.
    if (wait <= 0) {
      setNow((previous) => (previous < at ? Date.now() : previous));
      return undefined;
    }
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(wait, MAX_TIMEOUT_MS));
    return () => window.clearTimeout(timer);
  }, [awake, at]);
  return now;
}

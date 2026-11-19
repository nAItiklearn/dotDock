import { create } from "zustand";
import type { ProviderIssue, ProviderName, ProviderPayloads, ProviderState } from "./types";

type States = { [K in ProviderName]: ProviderState<ProviderPayloads[K]> };

const CACHE_PREFIX = "dotdock.cache.";
const PROVIDERS: readonly ProviderName[] = ["battery", "system", "weather"];

/** Last-known values let widgets paint real data on the first frame after boot. */
function readCache<K extends ProviderName>(name: K): ProviderPayloads[K] | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + name);
    return raw ? (JSON.parse(raw) as ProviderPayloads[K]) : null;
  } catch {
    return null;
  }
}

const pendingWrites = new Map<ProviderName, unknown>();
let flushScheduled = false;

/** Cache writes are batched off the hot path; providers can update every second. */
function scheduleCacheWrite(name: ProviderName, data: unknown): void {
  pendingWrites.set(name, data);
  if (flushScheduled) return;
  flushScheduled = true;
  const flush = (): void => {
    flushScheduled = false;
    for (const [key, value] of pendingWrites) {
      try {
        localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
      } catch {
        // Storage full or unavailable: the cache is an optimisation, live data still flows.
      }
    }
    pendingWrites.clear();
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(flush, { timeout: 2000 });
  else setTimeout(flush, 0);
}

function initialStates(): States {
  const entries = PROVIDERS.map((name) => {
    const data = readCache(name);
    return [name, { data, stale: data !== null, issue: null }];
  });
  return Object.fromEntries(entries) as States;
}

interface ProviderStore {
  readonly states: States;
  publish: <K extends ProviderName>(name: K, data: ProviderPayloads[K]) => void;
  report: (name: ProviderName, issue: ProviderIssue) => void;
}

export const useProviderStore = create<ProviderStore>((set) => ({
  states: initialStates(),
  publish: (name, data) => {
    scheduleCacheWrite(name, data);
    set((s) => ({ states: { ...s.states, [name]: { data, stale: false, issue: null } } }));
  },
  report: (name, issue) =>
    set((s) => ({ states: { ...s.states, [name]: { ...s.states[name], issue } } })),
}));

export function useProvider<K extends ProviderName>(name: K): ProviderState<ProviderPayloads[K]> {
  return useProviderStore((s) => s.states[name]) as ProviderState<ProviderPayloads[K]>;
}

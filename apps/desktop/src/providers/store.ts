import { create } from "zustand";
import type { ProviderIssue, ProviderName, ProviderPayloads, ProviderState } from "./types";

type States = { [K in ProviderName]: ProviderState<ProviderPayloads[K]> };

/**
 * Bump when any payload shape changes: an older cache is then ignored instead of crashing the
 * first render after an update.
 */
const CACHE_VERSION = 2;
const CACHE_PREFIX = `dotdock.cache.v${CACHE_VERSION}.`;
const PROVIDERS: readonly ProviderName[] = ["battery", "system", "weather", "media"];
/**
 * Providers whose last value is worth painting at boot. Media is excluded: a track from the
 * last session is not "now playing", and cover art is too large to keep in localStorage.
 */
const CACHED: ReadonlySet<ProviderName> = new Set<ProviderName>(["battery", "system", "weather"]);

/** Last-known values let widgets paint real data on the first frame after boot. */
function readCache<K extends ProviderName>(name: K): ProviderPayloads[K] | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + name);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? (parsed as ProviderPayloads[K]) : null;
  } catch {
    return null;
  }
}

const pendingWrites = new Map<ProviderName, string>();
let flushScheduled = false;

/** Cache writes are batched off the hot path; providers can update every second. */
function scheduleCacheWrite(name: ProviderName, json: string): void {
  pendingWrites.set(name, json);
  if (flushScheduled) return;
  flushScheduled = true;
  const flush = (): void => {
    flushScheduled = false;
    for (const [key, value] of pendingWrites) {
      try {
        localStorage.setItem(CACHE_PREFIX + key, value);
      } catch {
        // Storage full or unavailable: the cache is an optimisation, live data still flows.
      }
    }
    pendingWrites.clear();
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(flush, { timeout: 2000 });
  else setTimeout(flush, 0);
}

/** Serialised last payload per provider, to drop identical updates before they re-render anything. */
const lastJson = new Map<ProviderName, string>();

function initialStates(): States {
  const entries = PROVIDERS.map((name) => {
    const data = CACHED.has(name) ? readCache(name) : null;
    return [name, { data, stale: data !== null, issue: null }];
  });
  return Object.fromEntries(entries) as States;
}

interface ProviderStore {
  readonly states: States;
  publish: <K extends ProviderName>(name: K, data: ProviderPayloads[K]) => void;
  report: (name: ProviderName, issue: ProviderIssue) => void;
}

export const useProviderStore = create<ProviderStore>((set, get) => ({
  states: initialStates(),
  publish: (name, data) => {
    const json = JSON.stringify(data);
    const current = get().states[name];
    if (lastJson.get(name) === json && !current.stale && current.issue === null) return;
    lastJson.set(name, json);
    if (CACHED.has(name)) scheduleCacheWrite(name, json);
    set((s) => ({ states: { ...s.states, [name]: { data, stale: false, issue: null } } }));
  },
  report: (name, issue) => {
    if (get().states[name].issue === issue) return;
    set((s) => ({ states: { ...s.states, [name]: { ...s.states[name], issue } } }));
  },
}));

export function useProvider<K extends ProviderName>(name: K): ProviderState<ProviderPayloads[K]> {
  return useProviderStore((s) => s.states[name]) as ProviderState<ProviderPayloads[K]>;
}

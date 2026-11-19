import { createJSONStorage, type PersistOptions } from "zustand/middleware";

/**
 * Local persistence for widgets that own user data (notes, to-do, timer).
 * Each store lives under one localStorage key with a schema version. A stored value from an older
 * version goes through `migrate`; one that cannot be read is ignored and the defaults are used.
 * Every overlay window shares the same storage, so a change in one window reaches the others.
 */
const KEY_PREFIX = "dotdock.widgets.";

export interface PersistSpec<S, P> {
  /** Storage key suffix, e.g. "notes". */
  readonly name: string;
  /** Bump when the stored shape changes, and handle the old shape in `migrate`. */
  readonly version: number;
  /** Picks what is saved. Transient UI state is left out. */
  readonly partialize: (state: S) => P;
  readonly migrate?: (stored: unknown, fromVersion: number) => P;
}

export function persistOptions<S, P>(spec: PersistSpec<S, P>): PersistOptions<S, P> {
  return {
    name: KEY_PREFIX + spec.name,
    version: spec.version,
    storage: createJSONStorage(() => localStorage),
    partialize: spec.partialize,
    ...(spec.migrate ? { migrate: spec.migrate as (stored: unknown, fromVersion: number) => P | Promise<P> } : {}),
  };
}

interface Rehydratable {
  readonly persist: { readonly rehydrate: () => Promise<void> | void };
}

/** Re-reads a store when another window writes it. Call once per store, with its `name`. */
export function syncAcrossWindows(name: string, store: Rehydratable): void {
  // Modules are also imported where there is no window (unit tests); there is nothing to sync there.
  if (typeof window === "undefined") return;
  const key = KEY_PREFIX + name;
  window.addEventListener("storage", (event) => {
    if (event.key === key) void store.persist.rehydrate();
  });
}

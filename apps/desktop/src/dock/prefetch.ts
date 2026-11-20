import { useEffect, useState } from "react";

/**
 * The panels are separate chunks so a dock nobody touches pays nothing for them at start. They are loaded as
 * soon as the browser is idle after the first paint (not when the pointer comes near), so by the time anyone
 * reaches for a stack the code is already parsed and nothing waits on the network or the module system.
 */
export const loadStackPopover = (): Promise<typeof import("./StackPopover")> => import("./StackPopover");
export const loadContextMenu = (): Promise<typeof import("./ContextMenu")> => import("./ContextMenu");
export const loadLibrary = (): Promise<typeof import("./Library")> => import("./Library");
export const loadTilePopover = (): Promise<typeof import("./tiles/popovers")> => import("./tiles/popovers");
export const loadPreview = (): Promise<typeof import("./Preview")> => import("./Preview");

type Loader<M> = () => Promise<M>;

const loaded = new Map<Loader<never>, unknown>();

/**
 * A panel's module once it has loaded, null before. A module that is already loaded is returned on the very
 * first render, so opening a panel never goes through a suspended render.
 */
export function usePanel<M>(load: Loader<M>, wanted: boolean): M | null {
  const [module, setModule] = useState<M | null>(() => (loaded.get(load as Loader<never>) as M | undefined) ?? null);
  useEffect(() => {
    if (!wanted || module !== null) return undefined;
    let live = true;
    load().then(
      (m) => {
        loaded.set(load as Loader<never>, m);
        if (live) setModule(m);
      },
      (error: unknown) => console.error("a dock panel failed to load", error),
    );
    return () => {
      live = false;
    };
  }, [load, module, wanted]);
  return module;
}

/** Runs `task` when the browser is idle, and no later than `timeout` ms from now. Returns a function that cancels it. */
export function whenIdle(task: () => void, timeout: number): () => void {
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(task, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(task, timeout);
  return () => clearTimeout(id);
}

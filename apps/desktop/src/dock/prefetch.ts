/**
 * The panels are separate chunks, loaded the first time the pointer comes near the dock rather than at start,
 * so a dock nobody touches never pays for them. Loading is idempotent: the module system caches the chunks.
 */
export const loadStackPopover = (): Promise<typeof import("./StackPopover")> => import("./StackPopover");
export const loadContextMenu = (): Promise<typeof import("./ContextMenu")> => import("./ContextMenu");
export const loadLibrary = (): Promise<typeof import("./Library")> => import("./Library");
export const loadPreview = (): Promise<typeof import("./Preview")> => import("./Preview");

let started = false;

/** Starts loading every panel chunk, once. */
export function prefetchPanels(): void {
  if (started) return;
  started = true;
  void loadStackPopover();
  void loadContextMenu();
  void loadLibrary();
  void loadPreview();
}

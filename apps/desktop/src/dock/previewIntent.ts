import { IDLE, nextPreview, previewKey, wakeupIn, type PreviewEvent, type PreviewState } from "./hoverIntent";
import type { DockWindow } from "./protocol";
import { useDockStore } from "./store";

/** A running app (or a group of windows with no Start menu entry) the preview can show. */
export interface PreviewSubject {
  readonly key: string;
  readonly name: string;
  readonly icon: string;
  readonly windows: readonly DockWindow[];
}

type StoreState = ReturnType<typeof useDockStore.getState>;

/** The running app a bar key stands for, or null for keys without windows. */
export function subjectFor(key: string | null, store: Pick<StoreState, "apps" | "windows">): PreviewSubject | null {
  if (key === null) return null;
  if (key.startsWith("app:")) {
    const app = store.apps.find((a) => `app:${a.id}` === key);
    const windows = store.windows.filter((w) => w.appId === app?.id);
    return app && windows.length > 0 ? { key, name: app.name, icon: app.icon, windows } : null;
  }
  if (key.startsWith("exe:")) {
    const windows = store.windows.filter((w) => w.appId === null && `exe:${w.icon}` === key);
    const first = windows[0];
    return first ? { key, name: first.title, icon: first.icon, windows } : null;
  }
  return null;
}

// The machine lives outside React: it is driven by pointer events and its own one-shot timer, so an idle
// dock has no timer running at all.
let state: PreviewState = IDLE;
let timer = 0;

function apply(event: PreviewEvent): void {
  state = nextPreview(state, event);
  window.clearTimeout(timer);
  const wait = wakeupIn(state, event.now);
  if (wait !== null) timer = window.setTimeout(() => apply({ type: "tick", now: performance.now() }), wait);
  useDockStore.getState().setPreviewKey(previewKey(state));
}

export const enterPreview = (key: string): void => apply({ type: "enter", key, now: performance.now() });
export const leavePreview = (): void => apply({ type: "leave", now: performance.now() });

/**
 * The engine calls this when the pointer moves onto another bar item (or off the bar). Only running apps have a
 * preview, and only while nothing else is open. It does not touch React: sweeping along the dock re-renders nothing.
 */
export function onBarHover(key: string | null): void {
  const store = useDockStore.getState();
  const free = !store.editing && store.stack === null && store.menu === null && !store.libraryOpen;
  if (free && key !== null && subjectFor(key, store) !== null) enterPreview(key);
  else leavePreview();
}

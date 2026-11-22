/**
 * When the window preview opens and closes. Hovering a running app opens it after a short dwell; once one is
 * open, moving to another running app switches at once; leaving closes it after a grace period that lets the
 * pointer travel from the icon to the panel.
 */
export const PREVIEW_DELAY_MS = 380;
export const PREVIEW_GRACE_MS = 240;

export type PreviewState =
  | { readonly phase: "idle" }
  | { readonly phase: "pending"; readonly key: string; readonly since: number }
  | { readonly phase: "open"; readonly key: string }
  | { readonly phase: "closing"; readonly key: string; readonly since: number };

export type PreviewEvent =
  | { readonly type: "enter"; readonly key: string; readonly now: number }
  | { readonly type: "leave"; readonly now: number }
  | { readonly type: "tick"; readonly now: number };

export const IDLE: PreviewState = { phase: "idle" };

export function nextPreview(state: PreviewState, event: PreviewEvent): PreviewState {
  switch (event.type) {
    case "enter":
      if (state.phase === "open" || state.phase === "closing") return { phase: "open", key: event.key };
      if (state.phase === "pending" && state.key === event.key) return state;
      return { phase: "pending", key: event.key, since: event.now };
    case "leave":
      if (state.phase === "open") return { phase: "closing", key: state.key, since: event.now };
      if (state.phase === "pending") return IDLE;
      return state;
    case "tick":
      if (state.phase === "pending" && event.now - state.since >= PREVIEW_DELAY_MS) return { phase: "open", key: state.key };
      if (state.phase === "closing" && event.now - state.since >= PREVIEW_GRACE_MS) return IDLE;
      return state;
  }
}

/** Milliseconds until the state needs a `tick`, or null when it is waiting for the user. */
export function wakeupIn(state: PreviewState, now: number): number | null {
  if (state.phase === "pending") return Math.max(0, PREVIEW_DELAY_MS - (now - state.since));
  if (state.phase === "closing") return Math.max(0, PREVIEW_GRACE_MS - (now - state.since));
  return null;
}

export const previewKey = (state: PreviewState): string | null => (state.phase === "idle" || state.phase === "pending" ? null : state.key);

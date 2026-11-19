import type { SessionView, Snapshot } from "./protocol";

/** The session on screen: the one the user picked while it is still visible, else the core's suggestion. */
export function resolveCurrent(snapshot: Snapshot, pinnedId: string | null): SessionView | null {
  const byId = (id: string | null): SessionView | undefined =>
    id === null ? undefined : snapshot.sessions.find((s) => s.id === id);
  return byId(pinnedId) ?? byId(snapshot.current) ?? snapshot.sessions[0] ?? null;
}

/** Id of the session `step` places away from `currentId`. Stops at both ends instead of wrapping. */
export function stepSession(snapshot: Snapshot, currentId: string | null, step: -1 | 1): string | null {
  const index = snapshot.sessions.findIndex((s) => s.id === currentId);
  if (index < 0) return null;
  return snapshot.sessions[index + step]?.id ?? null;
}

/** Drops a pin whose session is gone, so a later session with the same id is not shown by surprise. */
export function pruneUnavailablePin(snapshot: Snapshot, pinnedId: string | null): string | null {
  return pinnedId !== null && snapshot.sessions.some((s) => s.id === pinnedId) ? pinnedId : null;
}

/** +1 when `to` sits after `from` in the list, -1 when before. Drives the slide direction of the content swap. */
export function directionBetween(snapshot: Snapshot, from: string | null, to: string | null): 1 | -1 {
  const a = snapshot.sessions.findIndex((s) => s.id === from);
  const b = snapshot.sessions.findIndex((s) => s.id === to);
  return a >= 0 && b >= 0 && b < a ? -1 : 1;
}

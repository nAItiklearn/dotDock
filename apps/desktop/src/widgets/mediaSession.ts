import type { MediaData, ProviderState } from "../providers/types";

/**
 * The session the music widget shows, or null for its "nothing playing" state. The core reports
 * `no-device` when the player that had the session closes; the provider store keeps the last payload
 * then, but that track is gone: showing it would leave a play button that controls nothing.
 * Remembered media from a previous run is never shown as if it were playing now either.
 */
export function activeSession(state: ProviderState<MediaData>): MediaData | null {
  if (state.stale || state.issue === "no-device") return null;
  return state.data;
}

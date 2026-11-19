/**
 * Sample provider values for the widget gallery only. They exist so every state of every widget can
 * be reviewed in a plain browser, where the real providers are not available. Product code never
 * imports this file.
 */
import { useProviderStore } from "../../providers/store";
import type { MediaData, ProviderIssue, ProviderName, ProviderPayloads, ProviderState } from "../../providers/types";

const GIB = 1024 ** 3;
const NOW = Date.now();

const ARTWORK = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#1b1b1b"/><circle cx="60" cy="60" r="44" fill="none" stroke="#e8e6e3" stroke-width="2"/><circle cx="60" cy="60" r="30" fill="none" stroke="#e8e6e3" stroke-width="2"/><circle cx="60" cy="60" r="16" fill="#e94248"/></svg>`,
)}`;

export const SAMPLE_MEDIA: MediaData = {
  title: "Night Drive Through Glass",
  artist: "Marlow Ember",
  album: "Low Light Hours",
  artwork: ARTWORK,
  positionSec: 83,
  durationSec: 214,
  playing: true,
  canSeek: true,
  canNext: true,
  canPrev: true,
};

const SAMPLES: ProviderPayloads = {
  battery: { percent: 64, charging: true, secondsRemaining: 4380 },
  system: {
    memTotalBytes: 15.9 * GIB,
    memUsedBytes: 10.3 * GIB,
    cpuPercent: 27,
    disks: [{ mount: "C:", totalBytes: 236 * GIB, usedBytes: 181 * GIB }],
  },
  weather: { place: "Chennai", temperatureC: 31, highC: 34, lowC: 26, code: 2, isDay: true, fetchedAt: NOW - 120_000 },
  media: SAMPLE_MEDIA,
};

export type GalleryState = "live" | "cache" | "offline" | "empty" | "error" | "loading";

export const GALLERY_STATES: readonly GalleryState[] = ["live", "cache", "offline", "empty", "error", "loading"];

const EMPTY_ISSUE: Record<ProviderName, ProviderIssue> = {
  battery: "no-device",
  system: "unsupported",
  weather: "needs-setup",
  media: "no-device",
};

const NAMES = Object.keys(SAMPLES) as ProviderName[];

function stateFor<K extends ProviderName>(name: K, mode: GalleryState): ProviderState<ProviderPayloads[K]> {
  const data = SAMPLES[name];
  switch (mode) {
    case "live":
      return { data, stale: false, issue: null };
    case "cache":
      return { data, stale: true, issue: null };
    case "offline":
      return { data, stale: false, issue: "offline" };
    case "empty":
      return { data: null, stale: false, issue: EMPTY_ISSUE[name] };
    case "error":
      return { data: null, stale: false, issue: "error" };
    case "loading":
      return { data: null, stale: false, issue: null };
  }
}

/** Puts every provider into one state, the way the real store would look in that situation. */
export function applyGalleryState(mode: GalleryState): void {
  const states = Object.fromEntries(NAMES.map((name) => [name, stateFor(name, mode)]));
  useProviderStore.setState({ states: states as ReturnType<typeof useProviderStore.getState>["states"] });
}

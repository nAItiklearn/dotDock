import { create } from "zustand";
import { appendRate, type RateSample } from "./network";

interface NetworkHistory {
  readonly samples: readonly RateSample[];
  readonly push: (sample: RateSample) => void;
}

/** The last minute of network throughput, kept while the network tile is on the dock. */
export const useNetworkHistory = create<NetworkHistory>((set) => ({
  samples: [],
  push: (sample) => set((s) => ({ samples: appendRate(s.samples, sample) })),
}));

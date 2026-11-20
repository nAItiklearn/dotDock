import { useEffect } from "react";
import { create } from "zustand";
import { useProvider } from "../../providers/store";
import { appendSample, type Sample } from "./history";

const PERCENT = 100;

interface HistoryStore {
  readonly samples: readonly Sample[];
  readonly push: (sample: Sample) => void;
}

/** The last minute of processor and memory load, kept while the system tile is on the dock. */
export const useSystemHistory = create<HistoryStore>((set) => ({
  samples: [],
  push: (sample) => set((s) => ({ samples: appendSample(s.samples, sample) })),
}));

/** Records every reading the system provider pushes. Mount it where the system tile is, so the graph is full when its popover opens. */
export function useRecordSystemLoad(): void {
  const { data } = useProvider("system");
  const push = useSystemHistory((s) => s.push);
  useEffect(() => {
    if (!data || data.memTotalBytes <= 0) return;
    push({ at: Date.now(), cpu: data.cpuPercent, mem: (data.memUsedBytes / data.memTotalBytes) * PERCENT });
  }, [data, push]);
}

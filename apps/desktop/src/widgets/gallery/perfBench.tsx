/**
 * Gallery only (?perf=1): one photo widget whose size and picture the capture script changes
 * while it records frame intervals (tools/capture/photo-qa.mjs, perf mode). Product code never
 * imports this file.
 */
import { useEffect, useState } from "react";
import { readPhotoFile, savePhoto } from "../photo/blobs";
import { PHOTO_SIZES } from "../photo/config";
import { usePhotoStore } from "../photo/store";
import { WidgetView } from "../WidgetView";

/** Placement id of the bench widget. */
export const BENCH_ID = "gallery-perf-bench";
/** Frames between two size changes in the resize run: a drag that crosses a preset every few frames. */
const FRAMES_PER_SIZE = 6;
/** Frames between two picture swaps. */
const FRAMES_PER_SWAP = 30;
/** Length of each recorded run. */
const RUN_MS = 4000;

type Recorder = (ms: number, step: (frame: number) => void) => Promise<unknown>;

declare global {
  interface Window {
    __photoQa?: (record: Recorder) => Promise<unknown>;
  }
}

async function load(url: string) {
  const blob = await (await fetch(url)).blob();
  const read = await readPhotoFile(new File([blob], url.split("/").pop() ?? "bench", { type: blob.type }));
  if (typeof read === "string") throw new Error(`The bench photo ${url} was refused: ${read}`);
  return read;
}

/** The bench widget; `photos` are swapped in turn during the swap run. */
export function PerfBench({ photos, config }: { readonly photos: readonly string[]; readonly config: Readonly<Record<string, unknown>> }) {
  const [size, setSize] = useState<string>("medium");
  useEffect(() => {
    window.__photoQa = async (record) => {
      const reads = await Promise.all(photos.map(load));
      const sizes = PHOTO_SIZES.map((s) => s.id);
      const resize = await record(RUN_MS, (frame) => {
        if (frame % FRAMES_PER_SIZE === 0) setSize(sizes[(frame / FRAMES_PER_SIZE) % sizes.length] ?? "medium");
      });
      const resizeAgain = await record(RUN_MS, (frame) => {
        if (frame % FRAMES_PER_SIZE === 0) setSize(sizes[(frame / FRAMES_PER_SIZE) % sizes.length] ?? "medium");
      });
      setSize("l");
      const swap = await record(RUN_MS, (frame) => {
        if (frame % FRAMES_PER_SWAP !== 0) return;
        const photo = reads[(frame / FRAMES_PER_SWAP) % reads.length];
        if (photo) void savePhoto(BENCH_ID, photo).then(() => usePhotoStore.getState().replaced(BENCH_ID));
      });
      return { photos, framesPerSize: FRAMES_PER_SIZE, framesPerSwap: FRAMES_PER_SWAP, resizeFirstCycle: resize, resizeWarm: resizeAgain, swap };
    };
    return () => {
      delete window.__photoQa;
    };
  }, [photos]);
  return <WidgetView id="photo" size={size} config={config} instanceId={BENCH_ID} />;
}

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../providers/bridge";

interface HitRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Margin around each widget that still counts as "over it", so hover never flickers at the edge. */
const HIT_MARGIN = 6;

/** IPC failures here are non-fatal (the core has a show fallback) but must be visible in devtools. */
function call(cmd: string, args?: Record<string, unknown>): void {
  invoke(cmd, args).catch((err: unknown) => console.error(`${cmd} failed`, err));
}

/**
 * Tells the core the DOM is committed with fonts and cached data, so it can show the window.
 * Not frame-based on purpose: a hidden window gets no animation frames.
 */
export function reportFirstFrame(): void {
  if (isTauri()) call("overlay_ready");
}

function collectRects(root: HTMLElement): HitRect[] {
  return [...root.querySelectorAll<HTMLElement>("[data-hit]")].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - HIT_MARGIN, y: r.top - HIT_MARGIN, w: r.width + 2 * HIT_MARGIN, h: r.height + 2 * HIT_MARGIN };
  });
}

/**
 * Keeps the core's click-through map in sync with where widgets are.
 * Everything outside these rectangles passes clicks to the desktop below.
 */
export function syncHitRegions(root: HTMLElement): () => void {
  if (!isTauri()) return () => undefined;
  let frame = 0;
  const push = (): void => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => call("set_hit_regions", { rects: collectRects(root) }));
  };
  const resize = new ResizeObserver(push);
  const watchAll = (): void => root.querySelectorAll<HTMLElement>("[data-hit]").forEach((el) => resize.observe(el));
  const mutations = new MutationObserver(() => {
    watchAll();
    push();
  });
  watchAll();
  mutations.observe(root, { childList: true, subtree: true });
  window.addEventListener("resize", push);
  push();
  return () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
    window.removeEventListener("resize", push);
  };
}

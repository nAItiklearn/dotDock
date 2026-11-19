import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../providers/bridge";

interface HitRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Margin around each hit area that still counts as "over it", so hover never flickers at the edge. */
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

/** Reports edit mode to the core so it can raise the overlay and give it keyboard focus (command `overlay_edit_mode`). */
export function reportEditMode(on: boolean): void {
  if (isTauri()) call("overlay_edit_mode", { on });
}

/**
 * Where an element will be once its transition settles. Positioned elements publish their final spot as
 * `data-tx` / `data-ty` (attributes never transition); everything else is static, so its measured box is final.
 */
function finalRect(el: HTMLElement): HitRect {
  const tx = Number.parseFloat(el.dataset["tx"] ?? "");
  const ty = Number.parseFloat(el.dataset["ty"] ?? "");
  if (Number.isFinite(tx) && Number.isFinite(ty)) {
    return { x: tx - HIT_MARGIN, y: ty - HIT_MARGIN, w: el.offsetWidth + 2 * HIT_MARGIN, h: el.offsetHeight + 2 * HIT_MARGIN };
  }
  const r = el.getBoundingClientRect();
  return { x: r.left - HIT_MARGIN, y: r.top - HIT_MARGIN, w: r.width + 2 * HIT_MARGIN, h: r.height + 2 * HIT_MARGIN };
}

export function collectHitRects(root: HTMLElement): HitRect[] {
  return [...root.querySelectorAll<HTMLElement>("[data-hit]")].map(finalRect);
}

let activeInvalidate: (() => void) | null = null;

/** Asks for a fresh hit-region push, e.g. right after layout changes moved widgets. Safe to call any time. */
export function invalidateHitRegions(): void {
  activeInvalidate?.();
}

/**
 * Keeps the core's click-through map in sync with every `[data-hit]` element: widgets, and in edit
 * mode the toolbar, drawer, toasts and the drag shield. Everything outside passes clicks to the desktop.
 */
export function syncHitRegions(root: HTMLElement): () => void {
  if (!isTauri()) return () => undefined;
  let frame = 0;
  let last = "";
  const push = (): void => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const rects = collectHitRects(root);
      const serialised = JSON.stringify(rects);
      if (serialised === last) return;
      last = serialised;
      call("set_hit_regions", { rects });
    });
  };
  const resize = new ResizeObserver(push);
  const watchAll = (): void => root.querySelectorAll<HTMLElement>("[data-hit]").forEach((el) => resize.observe(el));
  const mutations = new MutationObserver(() => {
    watchAll();
    push();
  });
  watchAll();
  mutations.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-hit"] });
  window.addEventListener("resize", push);
  activeInvalidate = push;
  push();
  return () => {
    activeInvalidate = null;
    cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
    window.removeEventListener("resize", push);
  };
}

import { useEffect, useRef, useState } from "react";
import { actions } from "./bridge";
import type { Rect, Size } from "./geometry";
import type { BarLayout } from "./Bar";
import { computeRegions, sameRegions, snapRect } from "./regions";
import { useDockStore } from "./store";

/** How long the dock waits after the pointer leaves before an auto-hidden dock slides away. */
export const AUTO_HIDE_DELAY_MS = 600;
/** How long an error notice stays above the dock. */
export const NOTICE_MS = 2800;

/** True while an auto-hiding dock should be out of sight. It returns at once and leaves after a short delay. */
export function useAutoHide(enabled: boolean, busy: boolean): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!enabled || busy) {
      setHidden(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setHidden(true), AUTO_HIDE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, busy]);
  return enabled && hidden;
}

export interface PanelRects {
  readonly [id: string]: Rect | null;
}

/**
 * Tells the core which rectangles take the pointer. Everything else clicks through to the desktop, so this is
 * what keeps a full-screen window from getting in the way of the apps beneath it.
 */
export function useRegions(layout: BarLayout | null, hidden: boolean, panels: PanelRects, viewport: Size): void {
  const pointerInside = useDockStore((s) => s.pointerInside);
  const libraryOpen = useDockStore((s) => s.libraryOpen);
  const sent = useRef<readonly Rect[]>([]);
  useEffect(() => {
    if (!layout) return;
    const open = Object.values(panels).filter((r): r is Rect => r !== null);
    const rects = computeRegions({
      bar: layout.bar,
      edge: layout.edge,
      engaged: pointerInside,
      headroom: layout.headroom,
      growth: layout.growth,
      hidden,
      panels: open,
      library: libraryOpen,
      viewport,
    }).map(snapRect);
    if (sameRegions(rects, sent.current)) return;
    sent.current = rects;
    actions.setRegions(rects);
  }, [layout, hidden, panels, viewport, pointerInside, libraryOpen]);
}

/** Asks the core for keyboard focus while something on screen needs keys, and hands it back afterwards. */
export function useKeyboardFocus(needed: boolean): void {
  useEffect(() => {
    actions.setFocus(needed);
    return () => {
      if (needed) actions.setFocus(false);
    };
  }, [needed]);
}

/** Clears the notice after a moment. */
export function useNoticeTimeout(): void {
  const notice = useDockStore((s) => s.notice);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => useDockStore.getState().setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
}

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { actions } from "./bridge";
import type { Rect, Size } from "./geometry";
import type { BarLayout } from "./Bar";
import { computeRegions, measurePanels, OPEN_PANEL_SELECTOR, sameRegions, snapRect } from "./regions";
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
export function useRegions(layout: BarLayout | null, hidden: boolean, autoHide: boolean, panels: PanelRects, viewport: Size, fullscreen: boolean): void {
  const pointerInside = useDockStore((s) => s.pointerInside);
  const sent = useRef<readonly Rect[]>([]);
  useEffect(() => {
    if (!layout) return;
    const open = Object.values(panels).filter((r): r is Rect => r !== null);
    const rects = computeRegions({
      bar: layout.bar,
      engaged: pointerInside,
      headroom: layout.headroom,
      growth: layout.growth,
      hidden,
      autoHide,
      panels: open,
      fullscreen,
      viewport,
    }).map(snapRect);
    if (sameRegions(rects, sent.current)) return;
    sent.current = rects;
    actions.setRegions(rects);
  }, [layout, hidden, autoHide, panels, viewport, pointerInside, fullscreen]);
}

/**
 * The drawn boxes of the open popovers and menus in `root`, kept current as panels open, close and move. Only
 * additions, removals and the open flag are watched: the bar's per-frame transforms never cause a measurement.
 */
export function useOpenPanelRects(root: RefObject<HTMLElement | null>, watching: boolean): PanelRects {
  const [rects, setRects] = useState<PanelRects>({});
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !watching) {
      setRects((previous) => (Object.keys(previous).length === 0 ? previous : {}));
      return undefined;
    }
    const measure = (): void => {
      const next = measurePanels(el.querySelectorAll<HTMLElement>(OPEN_PANEL_SELECTOR)).map(snapRect);
      setRects((previous) => {
        const before = Object.values(previous).filter((r): r is Rect => r !== null);
        return sameRegions(before, next) ? previous : Object.fromEntries(next.map((r, i) => [`open:${i}`, r]));
      });
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-open"] });
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [root, watching]);
  return rects;
}

/** Closes every open panel when the dock window loses focus: the user clicked an app beside it. */
export function useCloseOnBlur(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    const close = (): void => {
      const store = useDockStore.getState();
      store.setMenu(null);
      store.showTile(null);
      store.showGallery(null);
      store.showPrefs(null);
      store.openStack(null);
      store.setLibrary(false);
    };
    window.addEventListener("blur", close);
    return () => window.removeEventListener("blur", close);
  }, [active]);
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


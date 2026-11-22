import { useLayoutEffect, useRef, type RefObject } from "react";
import { isTauri } from "../providers/bridge";
import { actions } from "./bridge";
import type { Mode } from "./geometry";
import type { Regions } from "./protocol";
import { computeRegions, sameRegions } from "./regions";
import { useIslandStore } from "./store";

export interface RegionsOptions {
  /** Element laid out at the island's resting place. Its offset geometry ignores the slide transform. */
  readonly rest: RefObject<HTMLElement | null>;
  /** Offset parent of `rest`, whose own offset is added to reach window coordinates. */
  readonly anchor: RefObject<HTMLElement | null>;
  readonly mode: Mode;
  readonly moveAside: boolean;
  readonly aside: boolean;
  /** Anything else that changes where the island rests, so the rects are measured again. */
  readonly layoutKey: string;
  /** Another element that takes clicks (the connect offer), laid out in the same parent as `anchor`. */
  readonly extra?: RefObject<HTMLElement | null>;
}

const NO_REGIONS: Regions = { interactive: [], hover: null };

/**
 * Tells the core where clicks should land and which footprint counts as hover. In a plain browser there is
 * no core, so the same footprint drives the hover simulation from window pointer moves.
 */
export function useRegions({ rest, anchor, mode, moveAside, aside, layoutKey, extra }: RegionsOptions): void {
  const sent = useRef<Regions>(NO_REGIONS);
  const hover = useRef<Regions["hover"]>(null);

  useLayoutEffect(() => {
    const el = rest.current;
    const parent = anchor.current;
    const measure = (): void => {
      const rect =
        el && parent
          ? { x: parent.offsetLeft + el.offsetLeft, y: parent.offsetTop + el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }
          : { x: 0, y: 0, w: 0, h: 0 };
      const offer = extra?.current;
      const extraRect = offer ? { x: offer.offsetLeft, y: offer.offsetTop, w: offer.offsetWidth, h: offer.offsetHeight } : null;
      const next = computeRegions({ rest: rect, mode, moveAside, aside, extra: extraRect });
      hover.current = next.hover;
      if (sameRegions(next, sent.current)) return;
      sent.current = next;
      actions.reportRegions(next);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [rest, anchor, mode, moveAside, aside, layoutKey, extra]);

  useLayoutEffect(() => {
    if (isTauri()) return undefined;
    const { setPointerInside } = useIslandStore.getState();
    const move = (e: PointerEvent): void => {
      const box = hover.current;
      const origin = anchor.current?.parentElement?.getBoundingClientRect();
      if (!box || !origin) {
        setPointerInside(false);
        return;
      }
      const x = e.clientX - origin.left;
      const y = e.clientY - origin.top;
      setPointerInside(x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
    };
    const leave = (): void => setPointerInside(false);
    window.addEventListener("pointermove", move);
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [anchor]);
}

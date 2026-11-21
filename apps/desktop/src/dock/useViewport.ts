import { useEffect, useState } from "react";
import type { Size } from "./geometry";

/** The window's size in CSS px, kept current. The dock window covers the whole display. */
export function useViewport(): Size {
  const [size, setSize] = useState<Size>(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const update = (): void => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}

/** window.devicePixelRatio, kept current when the window moves to a screen with another scale (an OS event, no polling). */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const update = (): void => setDpr(window.devicePixelRatio || 1);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [dpr]);
  return dpr;
}

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

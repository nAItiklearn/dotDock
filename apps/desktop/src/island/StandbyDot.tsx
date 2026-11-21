import { useEffect, useRef } from "react";
import { createBreather } from "./standby";

export interface StandbyDotProps {
  /** False holds the dot at full light: the standby row is not shown, or motion is reduced. */
  readonly breathing: boolean;
}

/** The lit standby dot. Its light is set straight on the element by a timer, so React does not re-render. */
export function StandbyDot({ breathing }: StandbyDotProps) {
  const dot = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = dot.current;
    if (!el) return undefined;
    const breather = createBreather((v) => {
      el.style.opacity = String(v);
    });
    const start = (): void => breather.start(breathing && !document.hidden);
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      breather.stop();
      document.removeEventListener("visibilitychange", start);
    };
  }, [breathing]);

  return <i ref={dot} className="island__standby-lit" />;
}

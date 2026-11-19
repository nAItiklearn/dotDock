import { useEffect, useLayoutEffect, useRef } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import type { Size } from "./geometry";
import { parseShadow, settledAmount, squashedChrome, type ShadowSpec } from "./squash";
import { watchTheme } from "./icons/palette";

/** Slightly underdamped: the plate overshoots by a hair and settles, like a drop of liquid. */
const SPRING = { stiffness: 460, damping: 32, mass: 1 } as const;
/** When the plate shrinks, the content gets this long to fade out before the plate follows. */
const SHRINK_DELAY_MS = 80;

interface Chrome {
  readonly shadow: ShadowSpec | null;
  readonly hairline: number;
}

function readChrome(): Chrome {
  const style = getComputedStyle(document.documentElement);
  return { shadow: parseShadow(style.getPropertyValue("--shadow")), hairline: parseFloat(style.getPropertyValue("--hairline")) || 1 };
}

export interface PlateProps {
  /** Final size of the plate for the current mode, in px. */
  readonly size: Size;
  /** Corner radius at that final size, in px. */
  readonly radius: number;
  readonly visible: boolean;
}

/**
 * The glass plate behind the island. It is always laid out at its final size and grows by springing
 * scaleX and scaleY, so nothing but transforms moves on the compositor. Radius, hairline and shadow
 * are divided by the current squash so they never look stretched.
 */
export function Plate({ size, radius, visible }: PlateProps) {
  const reduced = useReducedMotion() ?? false;
  const chrome = useRef<Chrome>(readChrome());
  useEffect(() => watchTheme(() => (chrome.current = readChrome())), []);

  const w = useSpring(size.w, SPRING);
  const h = useSpring(size.h, SPRING);
  const r = useSpring(radius, SPRING);
  const finalW = useMotionValue(size.w);
  const finalH = useMotionValue(size.h);
  const lastArea = useRef(size.w * size.h);

  useLayoutEffect(() => {
    finalW.set(size.w);
    finalH.set(size.h);
    const area = size.w * size.h;
    const shrinking = area < lastArea.current;
    lastArea.current = area;
    const apply = (): void => {
      if (reduced) {
        w.jump(size.w);
        h.jump(size.h);
        r.jump(radius);
      } else {
        w.set(size.w);
        h.set(size.h);
        r.set(radius);
      }
    };
    if (!shrinking || reduced) {
      apply();
      return undefined;
    }
    const timer = setTimeout(apply, SHRINK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [size.w, size.h, radius, reduced, finalW, finalH, w, h, r]);

  const scaleX = useTransform(() => w.get() / finalW.get());
  const scaleY = useTransform(() => h.get() / finalH.get());
  const borderRadius = useTransform(() => squashedChrome(scaleX.get(), scaleY.get(), r.get(), chrome.current.hairline, chrome.current.shadow).borderRadius);
  const boxShadow = useTransform(() => squashedChrome(scaleX.get(), scaleY.get(), r.get(), chrome.current.hairline, chrome.current.shadow).boxShadow);
  const texture = useTransform(() => settledAmount(scaleX.get(), scaleY.get()));

  return (
    <motion.div
      className="island__plate"
      style={{ width: finalW, height: finalH, x: "-50%", scaleX, scaleY, borderRadius, boxShadow }}
      initial={false}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: reduced ? 0 : 0.2 }}
    >
      <motion.div className="island__texture" style={{ opacity: texture }} />
    </motion.div>
  );
}

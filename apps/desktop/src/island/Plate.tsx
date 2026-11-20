import { useEffect, useLayoutEffect, useRef } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
import type { Size } from "./geometry";
import { watchTheme } from "../design-system/themes";
import { parseShadow, settledAmount, squashedChrome, type ShadowSpec } from "./squash";

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

export interface PlateMotion {
  /** The size the plate is laid out at: its final size for the current mode. */
  readonly finalW: MotionValue<number>;
  readonly finalH: MotionValue<number>;
  /** The size it visibly has right now, springing toward the final size. */
  readonly width: MotionValue<number>;
  readonly height: MotionValue<number>;
  readonly radius: MotionValue<number>;
}

/**
 * Springs for the plate's visible size and corner radius. They are plain numbers: the plate turns them
 * into scale transforms, and rows that must stay glued to its bottom edge read `height` directly.
 */
export function usePlateMotion(size: Size, radius: number): PlateMotion {
  const reduced = useReducedMotion() ?? false;
  const width = useSpring(size.w, SPRING);
  const height = useSpring(size.h, SPRING);
  const round = useSpring(radius, SPRING);
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
        width.jump(size.w);
        height.jump(size.h);
        round.jump(radius);
      } else {
        width.set(size.w);
        height.set(size.h);
        round.set(radius);
      }
    };
    if (!shrinking || reduced) {
      apply();
      return undefined;
    }
    const timer = setTimeout(apply, SHRINK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [size.w, size.h, radius, reduced, finalW, finalH, width, height, round]);

  return { finalW, finalH, width, height, radius: round };
}

export interface PlateProps {
  readonly motion: PlateMotion;
  readonly visible: boolean;
}

/**
 * The glass plate behind the island. It is always laid out at its final size and grows by springing
 * scaleX and scaleY, so nothing but transforms moves on the compositor. Radius, hairline and shadow
 * are divided by the current squash so they never look stretched.
 */
export function Plate({ motion: m, visible }: PlateProps) {
  const reduced = useReducedMotion() ?? false;
  const chrome = useRef<Chrome>(readChrome());
  useEffect(() => watchTheme(() => (chrome.current = readChrome())), []);

  const scaleX = useTransform(() => m.width.get() / m.finalW.get());
  const scaleY = useTransform(() => m.height.get() / m.finalH.get());
  const borderRadius = useTransform(() => squashedChrome(scaleX.get(), scaleY.get(), m.radius.get(), chrome.current.hairline, chrome.current.shadow).borderRadius);
  const boxShadow = useTransform(() => squashedChrome(scaleX.get(), scaleY.get(), m.radius.get(), chrome.current.hairline, chrome.current.shadow).boxShadow);
  const texture = useTransform(() => settledAmount(scaleX.get(), scaleY.get()));

  return (
    <motion.div
      className="island__plate"
      style={{ width: m.finalW, height: m.finalH, x: "-50%", scaleX, scaleY, borderRadius, boxShadow }}
      initial={false}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: reduced ? 0 : 0.2 }}
    >
      <motion.div className="island__texture" style={{ opacity: texture }} />
    </motion.div>
  );
}

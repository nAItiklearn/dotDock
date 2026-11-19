import { useEffect } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { DotMatrix } from "../design-system/DotMatrix";
import { useNow } from "../providers/clock";
import { BASE } from "./geometry";
import { formatElapsed, formatTokens } from "./format";
import { TERMINAL_PHASES, type SessionView } from "./protocol";
import { t } from "./strings";

const COUNT_UP_SECONDS = 0.5;
/** The chunky 3 by 5 numerals stay legible at footer size; the fine 5 by 7 set turns to haze below about 20 px. */
const DIGIT_STYLE = "blocks";

/** Output tokens of this turn. The value is real; only the count-up between two real values is animation. */
export function TokenCount({ value }: { readonly value: number }) {
  const reduced = useReducedMotion() ?? false;
  const shown = useMotionValue(value);
  useEffect(() => {
    if (reduced) {
      shown.set(value);
      return undefined;
    }
    const run = animate(shown, value, { duration: COUNT_UP_SECONDS, ease: "easeOut" });
    return () => run.stop();
  }, [value, reduced, shown]);
  const text = useTransform(shown, (v) => formatTokens(v));
  return (
    <span className="foot__tokens" aria-label={t("aria.tokens", { count: formatTokens(value) })}>
      <svg className="foot__arrow" viewBox="0 0 8 8" aria-hidden="true">
        <path d="M4 7V1M1.2 3.8 4 1l2.8 2.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <motion.span className="foot__number">{text}</motion.span>
    </span>
  );
}

function ElapsedDigits({ text, scale }: { readonly text: string; readonly scale: number }) {
  return (
    <span className="foot__elapsed" aria-label={t("aria.elapsed", { time: text })}>
      <DotMatrix text={text} matrixStyle={DIGIT_STYLE} height={BASE.digitHeight * scale} label="" />
    </span>
  );
}

function LiveElapsed({ startedAt, scale }: { readonly startedAt: number; readonly scale: number }) {
  const now = useNow();
  return <ElapsedDigits text={formatElapsed(now.getTime() - startedAt) ?? ""} scale={scale} />;
}

/** Turn timer. Ticks once a second while the agent works and freezes at the final time when the turn ends. */
export function Elapsed({ session, scale }: { readonly session: SessionView; readonly scale: number }) {
  if (session.turnStartedAt === null) return <span className="foot__elapsed" />;
  if (TERMINAL_PHASES.has(session.phase)) {
    const text = formatElapsed(session.updatedAt - session.turnStartedAt) ?? "";
    return <ElapsedDigits text={text} scale={scale} />;
  }
  return <LiveElapsed startedAt={session.turnStartedAt} scale={scale} />;
}

import { useEffect } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useNow } from "../providers/clock";
import { formatElapsed, formatTokens } from "./format";
import { TERMINAL_PHASES, type SessionView } from "./protocol";
import { t } from "./strings";

const COUNT_UP_SECONDS = 0.5;

/**
 * Output tokens of this turn, dim, to the right of the state word. The value is real; only the count-up
 * between two real values is animation. Its width is reserved so the word never shifts as digits grow,
 * and it stays invisible until the first real tokens arrive.
 */
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
    <span className="tokens" data-empty={value <= 0 ? "true" : undefined} aria-label={t("aria.tokens", { count: formatTokens(value) })}>
      <svg className="tokens__arrow" viewBox="0 0 8 8" aria-hidden="true">
        <path d="M4 7V1M1.2 3.8 4 1l2.8 2.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <motion.span className="tokens__number">{text}</motion.span>
    </span>
  );
}

function LiveElapsed({ startedAt }: { readonly startedAt: number }) {
  const now = useNow();
  return <>{formatElapsed(now.getTime() - startedAt)}</>;
}

/** Turn timer text. Ticks once a second while the agent works and freezes at the final time when the turn ends. */
export function Elapsed({ session }: { readonly session: SessionView }) {
  if (session.turnStartedAt === null) return null;
  const label = TERMINAL_PHASES.has(session.phase) ? formatElapsed(session.updatedAt - session.turnStartedAt) : null;
  return (
    <span className="sub__time" aria-label={label ? t("aria.elapsed", { time: label }) : undefined}>
      {label ?? <LiveElapsed startedAt={session.turnStartedAt} />}
    </span>
  );
}

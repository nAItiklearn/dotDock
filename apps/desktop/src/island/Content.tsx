import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion, type MotionValue } from "motion/react";
import { Elapsed, TokenCount } from "./Counters";
import { BASE, type Layout, type Rows } from "./geometry";
import { ICONS, iconKindFor } from "./icons/frames";
import { StateIcon } from "./icons/StateIcon";
import type { IslandSettings, SessionView } from "./protocol";
import type { Flash } from "./store";
import { describeSession, t } from "./strings";

/** Distance content travels when it swaps, in px at scale 1. */
const SWAP_DISTANCE = 10;
const TEXT_SWAP_DISTANCE = 4;
/** How long the subtitle stays after its text goes away, so the island does not collapse between two tool calls. */
export const SUBTITLE_HOLD_MS = 1200;

/** Keeps `line` on screen for `holdMs` after it becomes null, but never across a change of session. */
export function useHeldLine(line: string | null, sessionId: string, holdMs: number): string | null {
  const [held, setHeld] = useState({ sessionId, line });
  useEffect(() => {
    if (line !== null) {
      setHeld({ sessionId, line });
      return undefined;
    }
    const timer = setTimeout(() => setHeld({ sessionId, line: null }), holdMs);
    return () => clearTimeout(timer);
  }, [line, sessionId, holdMs]);
  return line ?? (held.sessionId === sessionId ? held.line : null);
}

interface SwapProps {
  readonly id: string;
  readonly distance: number;
  readonly children: ReactNode;
  readonly className: string;
}

/** Crossfades a line of text with a short vertical slide whenever `id` changes. */
function Swap({ id, distance, children, className }: SwapProps) {
  const reduced = useReducedMotion() ?? false;
  const shift = reduced ? 0 : distance;
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={id}
        className={className}
        initial={{ opacity: 0, y: shift }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -shift }}
        transition={{ duration: reduced ? 0 : 0.16, ease: "easeOut" }}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}

export interface ContentProps {
  readonly session: SessionView;
  readonly settings: IslandSettings;
  readonly rows: Rows;
  readonly layout: Layout;
  /** What the dim line above the state row says; null leaves only the extras the settings ask for. */
  readonly subtitle: string | null;
  /** Replaces the state word while a click has nothing to show for it, such as "No window". */
  readonly flash: Flash | null;
  readonly direction: 1 | -1;
  /** False freezes the orb. */
  readonly live: boolean;
  /** Visible plate height minus the height the rows were laid out for; keeps the rows glued to the bottom edge. */
  readonly follow: MotionValue<number>;
}

function Subtitle({ session, settings, layout, subtitle }: Pick<ContentProps, "session" | "settings" | "layout" | "subtitle">) {
  const reduced = useReducedMotion() ?? false;
  const parts = [
    subtitle !== null ? (
      <Swap key="line" id={subtitle} distance={TEXT_SWAP_DISTANCE * settings.scale} className="sub__line">
        {subtitle}
      </Swap>
    ) : null,
    settings.showElapsed && session.turnStartedAt !== null ? <Elapsed key="time" session={session} /> : null,
    settings.showProject && session.project !== "" ? (
      <span key="project" className="sub__project">
        {session.project}
      </span>
    ) : null,
  ].filter((part) => part !== null);
  return (
    <motion.div
      className="sub"
      style={{ top: layout.subtitleTop }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.16 }}
    >
      {parts.flatMap((part, i) => (i === 0 ? [part] : [<span key={`dot-${i}`} className="sub__dot" aria-hidden="true">·</span>, part]))}
    </motion.div>
  );
}

/** The island's words: a dim line above, then the orb, the state word and the token count in one centred row. */
export function Content({ session, settings, rows, layout, subtitle, flash, direction, live, follow }: ContentProps) {
  const reduced = useReducedMotion() ?? false;
  const shown = flash && flash.sessionId === session.id ? flash.kind : null;
  const word = shown ? t(`flash.${shown}`) : describeSession(session).word;
  const tone = ICONS[iconKindFor(session.phase)].tone;
  const slide = reduced ? 0 : direction * SWAP_DISTANCE * settings.scale;
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={session.id}
        className="content"
        data-tone={tone}
        data-flash={shown ? "true" : undefined}
        initial={{ opacity: 0, x: slide }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -slide }}
        transition={{ duration: reduced ? 0 : 0.2, ease: "easeOut" }}
      >
        <AnimatePresence initial={false}>
          {rows.subtitle ? <Subtitle key="subtitle" session={session} settings={settings} layout={layout} subtitle={subtitle} /> : null}
        </AnimatePresence>
        <motion.div className="state" style={{ top: layout.rowTop, y: follow }}>
          <motion.span layout="position" className="state__orb">
            <StateIcon kind={iconKindFor(session.phase)} iconStyle={settings.iconStyle} cell={(BASE.orb * settings.scale) / 7} live={live} />
          </motion.span>
          <Swap id={word} distance={TEXT_SWAP_DISTANCE * settings.scale} className="state__word">
            {word}
          </Swap>
          {settings.showTokens ? (
            <motion.span layout="position" className="state__tokens">
              <TokenCount value={session.tokensOut} />
            </motion.span>
          ) : null}
        </motion.div>
        <span className="sr-only" role="status">
          {word}
        </span>
      </motion.div>
    </AnimatePresence>
  );
}

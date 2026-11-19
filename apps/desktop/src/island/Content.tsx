import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Elapsed, TokenCount } from "./Footer";
import { BASE, type Rows } from "./geometry";
import { ICONS, iconKindFor } from "./icons/frames";
import { StateIcon } from "./icons/StateIcon";
import { Pager } from "./Pager";
import type { Flash } from "./store";
import { t, describeSession, detailLine } from "./strings";
import type { IslandSettings, SessionView } from "./protocol";

/** Distance content travels when it swaps, in px at scale 1. */
const SWAP_DISTANCE = 10;
const TEXT_SWAP_DISTANCE = 4;

export interface ContentProps {
  readonly session: SessionView;
  readonly sessions: readonly SessionView[];
  readonly settings: IslandSettings;
  readonly rows: Rows;
  readonly flash: Flash | null;
  readonly direction: 1 | -1;
  /** False freezes the icon animation. */
  readonly live: boolean;
  readonly onPick: (id: string) => void;
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

/** What the island shows for one session: icon and state word, an optional detail line and an optional footer. */
export function Content({ session, sessions, settings, rows, flash, direction, live, onPick }: ContentProps) {
  const reduced = useReducedMotion() ?? false;
  const shown = flash && flash.sessionId === session.id ? flash.kind : null;
  const described = describeSession(session);
  const word = shown ? t(`flash.${shown}`) : described.word;
  const line = shown ? t(`flash.${shown}.hint`) : detailLine(session);
  const tone = ICONS[iconKindFor(session.phase)].tone;
  const agent = t(`agent.${session.agent}`);

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
        <div className="content__head">
          <StateIcon kind={iconKindFor(session.phase)} iconStyle={settings.iconStyle} cell={BASE.cell * settings.scale} live={live} />
          <Swap id={word} distance={TEXT_SWAP_DISTANCE * settings.scale} className="content__word">
            {word}
          </Swap>
          <Pager sessions={sessions} currentId={session.id} onPick={onPick} />
        </div>
        {rows.detail ? (
          <div className="content__detail">
            <Swap id={line ?? ""} distance={TEXT_SWAP_DISTANCE * settings.scale} className="content__line">
              {line ?? ""}
            </Swap>
          </div>
        ) : null}
        {rows.footer ? (
          <div className="content__foot foot">
            {settings.showTokens ? <TokenCount value={session.tokensOut} /> : null}
            {settings.showElapsed ? <Elapsed session={session} scale={settings.scale} /> : null}
            {settings.showProject ? (
              <span className="foot__project">
                <span className="foot__agent">{agent}</span>
                <span className="foot__name">{session.project}</span>
              </span>
            ) : null}
          </div>
        ) : null}
        <span className="sr-only" role="status">
          {`${word}. ${line ?? ""}`}
        </span>
      </motion.div>
    </AnimatePresence>
  );
}

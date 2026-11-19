import { motion, useReducedMotion } from "motion/react";
import { ICONS, iconKindFor } from "./icons/frames";
import type { SessionView } from "./protocol";
import { t } from "./strings";

export interface PagerProps {
  readonly sessions: readonly SessionView[];
  readonly currentId: string;
  readonly onPick: (id: string) => void;
}

/** One dot per visible session. The shown one stretches into an accent pill; the others carry their state's tone. */
export function Pager({ sessions, currentId, onPick }: PagerProps) {
  const reduced = useReducedMotion() ?? false;
  if (sessions.length < 2) return null;
  return (
    <div className="pager" role="tablist" aria-label={t("aria.pager")}>
      {sessions.map((s, i) => {
        const active = s.id === currentId;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={t("aria.session", { index: i + 1, count: sessions.length })}
            className="pager__hit"
            onClick={(e) => {
              e.stopPropagation();
              onPick(s.id);
            }}
            onContextMenu={(e) => e.stopPropagation()}
          >
            <motion.span
              layout={!reduced}
              className={`pager__dot${active ? " pager__dot--active" : ""}`}
              data-tone={ICONS[iconKindFor(s.phase)].tone}
              transition={{ type: "spring", stiffness: 520, damping: 34 }}
            />
          </button>
        );
      })}
    </div>
  );
}

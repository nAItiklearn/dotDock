import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import { motion, useReducedMotion, useSpring } from "motion/react";
import { actions } from "./bridge";
import { Content } from "./Content";
import { BASE, effectiveTopOffset, modeFor, plateSize, rowsFor } from "./geometry";
import { Plate } from "./Plate";
import { plateRadius } from "./squash";
import type { SessionView } from "./protocol";
import { useCurrentSession, useIslandStore } from "./store";
import { t } from "./strings";
import { useRegions } from "./useRegions";
import "./Island.css";

const SLIDE_SPRING = { stiffness: 300, damping: 31, mass: 1 } as const;
/** Horizontal wheel travel that counts as one swipe, and the pause between two swipes. */
const SWIPE_DISTANCE = 40;
const SWIPE_PAUSE_MS = 250;
const FLASH_MS = 2200;

function tokenRadius(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--radius-md")) || 0;
}

/** The floating status island. Everything it shows comes from the store; nothing here knows where data came from. */
export function Island() {
  const settings = useIslandStore((s) => s.settings);
  const sessions = useIslandStore((s) => s.snapshot.sessions);
  const pointerInside = useIslandStore((s) => s.pointerInside);
  const flash = useIslandStore((s) => s.flash);
  const direction = useIslandStore((s) => s.direction);
  const current = useCurrentSession();
  const reduced = useReducedMotion() ?? false;

  const lastShown = useRef<SessionView | null>(null);
  useEffect(() => {
    if (current) lastShown.current = current;
  }, [current]);
  const shown = current ?? lastShown.current;

  const mode = modeFor(settings, current);
  const rows = rowsFor(settings);
  const { scale } = settings;
  const active = mode === "compact" || mode === "island";
  const activeSize = plateSize(rows.detail || rows.footer ? "island" : "compact", rows, scale);
  const size = plateSize(mode, rows, scale);
  const top = effectiveTopOffset(settings.topOffset, activeSize.h, scale);
  const aside = active && settings.moveAside && pointerInside;

  const slide = useSpring(0, SLIDE_SPRING);
  useEffect(() => {
    const target = aside ? -(top + activeSize.h - BASE.sliver * scale) : 0;
    if (reduced) slide.jump(target);
    else slide.set(target);
  }, [aside, top, activeSize.h, scale, reduced, slide]);

  const slideRef = useRef<HTMLDivElement>(null);
  const restRef = useRef<HTMLDivElement>(null);
  useRegions({ rest: restRef, anchor: slideRef, mode, moveAside: settings.moveAside, aside, layoutKey: `${top}|${size.w}|${size.h}` });

  const flashId = flash?.sessionId ?? null;
  useEffect(() => {
    if (flashId === null) return undefined;
    const timer = setTimeout(() => useIslandStore.getState().setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash, flashId]);

  const swipe = useRef({ travel: 0, at: 0 });
  if (mode === "off") return null;

  const radius = plateRadius(mode !== "island", size.h, tokenRadius(), scale);
  const focusCurrent = (): void => {
    if (current) void actions.focus(current.id);
  };
  const onClick = (e: MouseEvent): void => {
    if (e.button === 0 && active) focusCurrent();
  };
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    if (active && current) actions.dismiss(current.id);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!active || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    focusCurrent();
  };
  const onWheel = (e: WheelEvent): void => {
    if (!active || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    swipe.current.travel += e.deltaX;
    const now = performance.now();
    if (Math.abs(swipe.current.travel) < SWIPE_DISTANCE || now - swipe.current.at < SWIPE_PAUSE_MS) return;
    useIslandStore.getState().step(swipe.current.travel > 0 ? 1 : -1);
    swipe.current = { travel: 0, at: now };
  };

  const vars = {
    "--k": scale,
    "--pad": `${BASE.padding * scale}px`,
    "--row-gap": `${BASE.rowGap * scale}px`,
    "--detail-row": `${BASE.detailRow * scale}px`,
    "--foot-row": `${BASE.footerRow * scale}px`,
    "--icon": `${BASE.cell * 7 * scale}px`,
    "--active-w": `${activeSize.w}px`,
    "--active-h": `${activeSize.h}px`,
    "--tiny-dot": `${3 * scale}px`,
  } as CSSProperties;

  return (
    <main className="island-root" style={vars}>
      <motion.div ref={slideRef} className="island-slide" style={{ y: slide, top }}>
        <div
          ref={restRef}
          className={`island island--${mode}${aside ? " island--aside" : ""}`}
          style={{ width: size.w, height: size.h }}
          role={active ? "button" : undefined}
          tabIndex={active ? 0 : -1}
          aria-label={active && current ? t("aria.focus", { project: current.project }) : t("aria.standby")}
          onClick={onClick}
          onContextMenu={onContextMenu}
          onKeyDown={onKeyDown}
          onWheel={onWheel}
        >
          <Plate size={size} radius={radius} visible={mode !== "hidden"} />
          <motion.div
            className="island__standby"
            aria-hidden="true"
            initial={false}
            animate={{ opacity: mode === "tiny" ? 1 : 0 }}
            transition={{ duration: reduced ? 0 : 0.14, delay: mode === "tiny" && !reduced ? 0.16 : 0 }}
          >
            <i />
            <i className="island__standby-lit" />
            <i />
          </motion.div>
          <motion.div
            className="island__active"
            initial={false}
            animate={{ opacity: active ? 1 : 0 }}
            transition={{ duration: reduced ? 0 : active ? 0.18 : 0.08, delay: active && !reduced ? 0.12 : 0 }}
          >
            {shown ? (
              <Content
                session={shown}
                sessions={sessions}
                settings={settings}
                rows={rows}
                flash={flash}
                direction={direction}
                live={active}
                onPick={(id) => useIslandStore.getState().pin(id)}
              />
            ) : null}
          </motion.div>
        </div>
      </motion.div>
    </main>
  );
}

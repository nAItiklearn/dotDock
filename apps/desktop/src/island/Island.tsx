import { useEffect, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { actions } from "./bridge";
import { Content, SUBTITLE_HOLD_MS, useHeldLine } from "./Content";
import { BASE, SCENE_HEIGHT, layoutFor, modeFor, plateSize } from "./geometry";
import { Pager } from "./Pager";
import { Plate, usePlateMotion } from "./Plate";
import type { SessionView } from "./protocol";
import { SceneCanvas } from "./scene/SceneCanvas";
import { SCENE_CELL } from "./scene/layout";
import { plateRadius } from "./squash";
import { useCurrentSession, useIslandStore } from "./store";
import { detailLine, t } from "./strings";
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

  const flashKind = flash && shown && flash.sessionId === shown.id ? flash.kind : null;
  const rawSubtitle = shown === null ? null : flashKind ? t(`flash.${flashKind}.hint`) : settings.showDetail ? detailLine(shown) : null;
  const subtitle = useHeldLine(rawSubtitle, shown?.id ?? "", SUBTITLE_HOLD_MS);
  const extras = shown !== null && ((settings.showElapsed && shown.turnStartedAt !== null) || (settings.showProject && shown.project !== ""));

  const mode = modeFor(settings, current);
  const rows = { subtitle: subtitle !== null || extras, scene: settings.showScene };
  const { scale } = settings;
  const active = mode === "island";
  const layout = layoutFor(rows, scale);
  const size = plateSize(mode, rows, scale);
  const top = settings.topOffset;
  const aside = active && settings.moveAside && pointerInside;

  const plate = usePlateMotion(size, plateRadius(mode !== "island", size.h, tokenRadius(), scale));
  const layoutHeight = useMotionValue(layout.h);
  useLayoutEffect(() => layoutHeight.set(layout.h), [layout.h, layoutHeight]);
  const follow = useTransform(() => plate.height.get() - layoutHeight.get());

  const slide = useSpring(0, SLIDE_SPRING);
  useEffect(() => {
    const target = aside ? -(top + layout.h - BASE.sliver * scale) : 0;
    if (reduced) slide.jump(target);
    else slide.set(target);
  }, [aside, top, layout.h, scale, reduced, slide]);

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
    "--sub-h": `${BASE.subtitleRow * scale}px`,
    "--state-h": `${BASE.stateRow * scale}px`,
    "--orb": `${BASE.orb * scale}px`,
    "--scene-w": `${BASE.islandWidth * scale - 2 * BASE.padding * scale}px`,
    "--scene-h": `${SCENE_HEIGHT * scale}px`,
    "--active-w": `${layout.w}px`,
    "--active-h": `${layout.h}px`,
    "--tiny-dot": `${3 * scale}px`,
  } as CSSProperties;
  const pagerTop = settings.showScene ? layout.sceneTop + 4 * scale : layout.rowTop;

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
          <Plate motion={plate} visible={mode !== "hidden"} />
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
              <>
                <Content
                  session={shown}
                  settings={settings}
                  rows={rows}
                  layout={layout}
                  subtitle={subtitle}
                  flash={flash}
                  direction={direction}
                  live={active}
                  follow={follow}
                />
                {settings.showScene ? (
                  <motion.div className="scene" style={{ top: layout.sceneTop, y: follow }}>
                    <SceneCanvas phase={shown.phase} sessionId={shown.id} iconStyle={settings.iconStyle} cell={SCENE_CELL * scale} live={active} />
                  </motion.div>
                ) : null}
                <motion.div className="pager-slot" style={{ top: pagerTop, y: follow }}>
                  <Pager sessions={sessions} currentId={shown.id} onPick={(id) => useIslandStore.getState().pin(id)} />
                </motion.div>
              </>
            ) : null}
          </motion.div>
        </div>
      </motion.div>
    </main>
  );
}

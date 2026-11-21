import { memo, useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { readPalette, watchTheme, type Palette } from "../icons/palette";
import type { IconStyle, Phase } from "../protocol";
import { STATIC_POSE } from "./creature";
import { drawScene, type PoseLayer } from "./draw";
import { SCENE_COLS, SCENE_ROWS } from "./layout";
import { ENTERING_SCENE, INITIAL_SCENE, stepScene, type SceneState } from "./motion";

/** Frames per second, with the same slack as the icon so a 60 Hz screen really gets 30. */
const FRAME_MS = 1000 / 30;
const FRAME_SLACK_MS = 4;
/** How long the old pose dissolves into the new one. */
const CROSSFADE_MS = 160;

const easeOut = (x: number): number => 1 - (1 - x) * (1 - x);

interface Shown {
  readonly phase: Phase;
  readonly since: number;
}

export interface SceneCanvasProps {
  readonly phase: Phase;
  /** The session shown. A session the island has not shown before walks its beetle in from the left. */
  readonly sessionId: string;
  readonly iconStyle: IconStyle;
  /** Pitch of one lattice cell in CSS px. */
  readonly cell: number;
  /** False freezes the scene (island collapsed or window hidden). */
  readonly live: boolean;
}

/**
 * The beetle and its landscape. The walk state lives here and is stepped every frame, so a change of phase
 * only changes how the beetle behaves from now on: it never jumps. Frames themselves are pure functions.
 */
export const SceneCanvas = memo(function SceneCanvas({ phase, sessionId, iconStyle, cell, live }: SceneCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion() ?? false;
  const shown = useRef<{ current: Shown; previous: Shown | null; changedAt: number }>({
    current: { phase, since: performance.now() },
    previous: null,
    changedAt: 0,
  });
  const scene = useRef<SceneState>(INITIAL_SCENE);
  const repaint = useRef<() => void>(() => undefined);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (seen.current.has(sessionId)) return;
    seen.current.add(sessionId);
    if (!reduced) scene.current = ENTERING_SCENE;
    repaint.current();
  }, [sessionId, reduced]);

  useEffect(() => {
    const record = shown.current;
    if (record.current.phase === phase) return;
    const now = performance.now();
    record.previous = record.current;
    record.current = { phase, since: now };
    record.changedAt = now;
    repaint.current();
  }, [phase]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return undefined;

    let palette: Palette = readPalette();
    let dpr = window.devicePixelRatio || 1;
    let frame = 0;
    let last = 0;
    let lastClock = performance.now();
    const origin = performance.now();

    const size = (): void => {
      dpr = window.devicePixelRatio || 1;
      el.width = Math.round(SCENE_COLS * cell * dpr);
      el.height = Math.round(SCENE_ROWS * cell * dpr);
    };

    const poses = (now: number): { poses: PoseLayer[]; t: number } => {
      const { current, previous, changedAt } = shown.current;
      const still = reduced || !live;
      const mix = still ? 1 : easeOut(Math.min(1, (now - changedAt) / CROSSFADE_MS));
      const pose = (s: Shown, weight: number): PoseLayer => ({
        phase: s.phase,
        tp: still ? STATIC_POSE[s.phase].tp : (now - s.since) / 1000,
        weight,
      });
      const list: PoseLayer[] = [pose(current, mix)];
      if (previous && mix < 1) list.push(pose(previous, 1 - mix));
      return { poses: list, t: still ? STATIC_POSE[current.phase].t : (now - origin) / 1000 };
    };

    const paint = (now: number): void => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const { poses: layers, t } = poses(now);
      drawScene(ctx, { state: scene.current, t, poses: layers }, iconStyle, palette, cell);
      if (now - shown.current.changedAt >= CROSSFADE_MS) shown.current.previous = null;
    };

    const tick = (stamp: number): void => {
      frame = requestAnimationFrame(tick);
      if (stamp - last < FRAME_MS - FRAME_SLACK_MS) return;
      last = stamp;
      const now = performance.now();
      scene.current = stepScene(scene.current, shown.current.current.phase, (now - lastClock) / 1000);
      lastClock = now;
      paint(now);
    };

    const start = (): void => {
      cancelAnimationFrame(frame);
      lastClock = performance.now();
      paint(lastClock);
      if (live && !reduced && !document.hidden) frame = requestAnimationFrame(tick);
    };

    size();
    repaint.current = start;
    start();

    const stopTheme = watchTheme(() => {
      palette = readPalette();
      start();
    });
    const onResize = (): void => {
      size();
      start();
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", start);

    return () => {
      cancelAnimationFrame(frame);
      repaint.current = () => undefined;
      stopTheme();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", start);
    };
  }, [cell, iconStyle, live, reduced]);

  return <canvas ref={canvas} style={{ width: SCENE_COLS * cell, height: SCENE_ROWS * cell }} aria-hidden="true" />;
});

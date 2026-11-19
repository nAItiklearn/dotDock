import { memo, useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import type { IconStyle } from "../protocol";
import { drawIcon, type Layer } from "./draw";
import { ICONS, LATTICE, type IconKind } from "./frames";
import { readPalette, watchTheme, type Palette } from "./palette";

/** Frames per second. Dot icons read as ticking, so 30 is plenty and keeps the island nearly free. */
const FRAME_MS = 1000 / 30;
/** Display refreshes rarely land exactly on the frame budget; without slack a 60 Hz screen would drop to 20 fps. */
const FRAME_SLACK_MS = 4;
/** How long the old state's dots dissolve into the new one. */
const CROSSFADE_MS = 200;

const easeOut = (x: number): number => 1 - (1 - x) * (1 - x);

interface Shown {
  readonly kind: IconKind;
  readonly since: number;
}

export interface StateIconProps {
  readonly kind: IconKind;
  readonly iconStyle: IconStyle;
  /** Pitch of one lattice cell in CSS px. */
  readonly cell: number;
  /** False freezes the icon (island collapsed or window hidden). */
  readonly live: boolean;
}

/** The 7 by 7 dot-matrix state icon. Drawn on a canvas; the frames themselves are pure functions in frames.ts. */
export const StateIcon = memo(function StateIcon({ kind, iconStyle, cell, live }: StateIconProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion() ?? false;
  const shown = useRef<{ current: Shown; previous: Shown | null; changedAt: number }>({
    current: { kind, since: performance.now() },
    previous: null,
    changedAt: 0,
  });
  const repaint = useRef<() => void>(() => undefined);

  useEffect(() => {
    const state = shown.current;
    if (state.current.kind === kind) return;
    const now = performance.now();
    state.previous = state.current;
    state.current = { kind, since: now };
    state.changedAt = now;
    repaint.current();
  }, [kind]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return undefined;

    const extent = cell * LATTICE;
    let palette: Palette = readPalette();
    let dpr = window.devicePixelRatio || 1;
    let frame = 0;
    let last = 0;

    const size = (): void => {
      dpr = window.devicePixelRatio || 1;
      el.width = Math.round(extent * dpr);
      el.height = Math.round(extent * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    const layers = (now: number): Layer[] => {
      const { current, previous, changedAt } = shown.current;
      const still = reduced || !live;
      const time = (s: Shown): number => (still ? ICONS[s.kind].staticT : (now - s.since) / 1000);
      const mix = still ? 1 : easeOut(Math.min(1, (now - changedAt) / CROSSFADE_MS));
      const out: Layer[] = [{ kind: current.kind, t: time(current), weight: mix }];
      if (previous && mix < 1) out.push({ kind: previous.kind, t: time(previous), weight: 1 - mix });
      return out;
    };

    const paint = (now: number): void => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawIcon(ctx, layers(now), iconStyle, palette, cell);
      if (now - shown.current.changedAt >= CROSSFADE_MS) shown.current.previous = null;
    };

    const tick = (now: number): void => {
      frame = requestAnimationFrame(tick);
      if (now - last < FRAME_MS - FRAME_SLACK_MS) return;
      last = now;
      paint(performance.now());
    };

    const start = (): void => {
      cancelAnimationFrame(frame);
      paint(performance.now());
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

  const extent = cell * LATTICE;
  return <canvas ref={canvas} style={{ width: extent, height: extent }} aria-hidden="true" />;
});

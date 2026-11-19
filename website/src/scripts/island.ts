/**
 * The agent island in the desktop shot. It plays a short scripted coding session through the real
 * island's states, drawn with the product's own code (lib/island, copied from apps/desktop):
 * the 7 x 7 state icon, the beetle and its parallax landscape, and the same walk physics.
 * It runs at 30 fps only while the island is on screen and the tab is visible; with reduced motion
 * it shows one still frame of the editing state.
 */
import { drawIcon, type Layer } from "../lib/island/icons/draw";
import { ICONS, LATTICE, iconKindFor, type IconKind } from "../lib/island/icons/frames";
import { readPalette, watchTheme, type Palette } from "../lib/island/icons/palette";
import type { Phase } from "../lib/island/protocol";
import { STATIC_POSE } from "../lib/island/scene/creature";
import { drawScene, type PoseLayer } from "../lib/island/scene/draw";
import { SCENE_COLS, SCENE_ROWS } from "../lib/island/scene/layout";
import { INITIAL_SCENE, stepScene, type SceneState } from "../lib/island/scene/motion";

interface Step {
  readonly phase: Phase;
  readonly word: string;
  readonly sub: string;
  readonly ms: number;
}

/** One turn of a session, in the words the island uses. File names are this project's own. */
const SESSION: readonly Step[] = [
  { phase: "thinking", word: "Thinking", sub: "", ms: 3200 },
  { phase: "reading", word: "Reading file", sub: "ClockWidget.tsx", ms: 3400 },
  { phase: "searching", word: "Searching", sub: "formatTime", ms: 2600 },
  { phase: "editing", word: "Editing file", sub: "ClockWidget.tsx", ms: 3400 },
  { phase: "running", word: "Running command", sub: "pnpm test", ms: 3800 },
  { phase: "thinking", word: "Thinking", sub: "", ms: 2400 },
  { phase: "done", word: "Done", sub: "Clock keeps 24-hour time", ms: 5200 },
];
const STILL_STEP = 3;

const FRAME_MS = 1000 / 30;
const FRAME_SLACK_MS = 4;
const ICON_FADE_MS = 200;
const SCENE_FADE_MS = 160;
/** Output tokens per second while the agent works, as the island counts them for the turn. */
const TOKENS_PER_SECOND = 14;
const TEXT_SWAP_MS = 220;

/** Output tokens of the turn so far: they grow while the agent works and hold once it is done. */
function tokensAt(index: number, intoStepMs: number): number {
  let ms = 0;
  for (let i = 0; i < index; i++) if (SESSION[i].phase !== "done") ms += SESSION[i].ms;
  if (SESSION[index].phase !== "done") ms += Math.min(intoStepMs, SESSION[index].ms);
  return Math.floor((TOKENS_PER_SECOND * ms) / 1000);
}

const easeOut = (x: number): number => 1 - (1 - x) * (1 - x);

interface Shown<K> {
  readonly value: K;
  readonly since: number;
}

function crossfade<K>(current: Shown<K>, previous: Shown<K> | null, changedAt: number, now: number, fadeMs: number) {
  const mix = easeOut(Math.min(1, (now - changedAt) / fadeMs));
  const out: { value: K; since: number; weight: number }[] = [{ ...current, weight: mix }];
  if (previous && mix < 1) out.push({ ...previous, weight: 1 - mix });
  return out;
}

/** Swaps a line of text with a short lift. The latest text always wins, even if swaps overlap. */
function swapText(el: HTMLElement, text: string, animate: boolean): void {
  if (el.dataset.text === text) return;
  el.dataset.text = text;
  if (!animate) {
    el.textContent = text;
    return;
  }
  for (const a of el.getAnimations()) a.cancel();
  const out = el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-0.3em)" }], {
    duration: TEXT_SWAP_MS / 2,
    easing: "ease-in",
  });
  out.onfinish = () => {
    el.textContent = el.dataset.text ?? "";
    el.animate([{ opacity: 0, transform: "translateY(0.3em)" }, { opacity: 1, transform: "none" }], {
      duration: TEXT_SWAP_MS / 2,
      easing: "ease-out",
    });
  };
}

function mount(root: HTMLElement): void {
  const orb = root.querySelector<HTMLCanvasElement>("[data-island-orb]");
  const sceneEl = root.querySelector<HTMLCanvasElement>("[data-island-scene]");
  const word = root.querySelector<HTMLElement>("[data-island-word]");
  const sub = root.querySelector<HTMLElement>("[data-island-sub]");
  const tokens = root.querySelector<HTMLElement>("[data-island-tokens]");
  const orbCtx = orb?.getContext("2d");
  const sceneCtx = sceneEl?.getContext("2d");
  if (!orb || !sceneEl || !word || !sub || !tokens || !orbCtx || !sceneCtx) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let palette: Palette = readPalette(root);
  let dpr = 1;
  let orbCell = 0;
  let sceneCell = 0;

  let stepIndex = 0;
  let stepStart = performance.now();
  let icon = { current: { value: iconKindFor(SESSION[0].phase) as IconKind, since: stepStart }, previous: null as Shown<IconKind> | null, changedAt: 0 };
  let pose = { current: { value: SESSION[0].phase, since: stepStart }, previous: null as Shown<Phase> | null, changedAt: 0 };
  let scene: SceneState = INITIAL_SCENE;
  let onScreen = false;
  let frame = 0;
  let last = 0;
  let lastClock = stepStart;
  const origin = stepStart;

  const size = (): void => {
    dpr = window.devicePixelRatio || 1;
    const orbBox = orb.getBoundingClientRect();
    const sceneBox = sceneEl.getBoundingClientRect();
    orbCell = orbBox.width / LATTICE;
    sceneCell = sceneBox.width / SCENE_COLS;
    orb.width = Math.round(orbBox.width * dpr);
    orb.height = Math.round(orbBox.width * dpr);
    sceneEl.width = Math.round(SCENE_COLS * sceneCell * dpr);
    sceneEl.height = Math.round(SCENE_ROWS * sceneCell * dpr);
  };

  const show = (step: Step, now: number, animate: boolean): void => {
    const kind = iconKindFor(step.phase);
    if (kind !== icon.current.value) icon = { previous: icon.current, current: { value: kind, since: now }, changedAt: now };
    if (step.phase !== pose.current.value) pose = { previous: pose.current, current: { value: step.phase, since: now }, changedAt: now };
    root.dataset.tone = ICONS[kind].tone;
    swapText(word, step.word, animate);
    swapText(sub, step.sub, animate);
  };

  const paint = (now: number, still: boolean): void => {
    const iconLayers: Layer[] = still
      ? [{ kind: icon.current.value, t: ICONS[icon.current.value].staticT, weight: 1 }]
      : crossfade(icon.current, icon.previous, icon.changedAt, now, ICON_FADE_MS).map((l) => ({ kind: l.value, t: (now - l.since) / 1000, weight: l.weight }));
    orbCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawIcon(orbCtx, iconLayers, "dots", palette, orbCell);

    const phase = pose.current.value;
    const poses: PoseLayer[] = still
      ? [{ phase, tp: STATIC_POSE[phase].tp, weight: 1 }]
      : crossfade(pose.current, pose.previous, pose.changedAt, now, SCENE_FADE_MS).map((l) => ({ phase: l.value, tp: (now - l.since) / 1000, weight: l.weight }));
    sceneCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(sceneCtx, { state: scene, t: still ? STATIC_POSE[phase].t : (now - origin) / 1000, poses }, "dots", palette, sceneCell);
  };

  const advance = (now: number): void => {
    const dt = (now - lastClock) / 1000;
    lastClock = now;
    while (now - stepStart >= SESSION[stepIndex].ms) {
      stepStart += SESSION[stepIndex].ms;
      stepIndex = (stepIndex + 1) % SESSION.length;
      show(SESSION[stepIndex], now, true);
    }
    const phase = SESSION[stepIndex].phase;
    tokens.textContent = String(tokensAt(stepIndex, now - stepStart));
    scene = stepScene(scene, phase, dt);
  };

  const tick = (stamp: number): void => {
    frame = requestAnimationFrame(tick);
    if (stamp - last < FRAME_MS - FRAME_SLACK_MS) return;
    last = stamp;
    const now = performance.now();
    advance(now);
    paint(now, false);
  };

  const start = (): void => {
    cancelAnimationFrame(frame);
    const now = performance.now();
    if (reduced.matches) {
      stepIndex = STILL_STEP;
      stepStart = now;
      lastClock = now;
      show(SESSION[STILL_STEP], now, false);
      icon = { ...icon, previous: null };
      pose = { ...pose, previous: null };
      tokens.textContent = String(tokensAt(STILL_STEP, 0));
      paint(now, true);
      return;
    }
    // A pause (off screen, hidden tab) resumes the session where it was rather than racing to catch up.
    const away = now - lastClock;
    stepStart += away;
    lastClock = now;
    paint(now, false);
    if (onScreen && !document.hidden) frame = requestAnimationFrame(tick);
  };

  const stop = (): void => {
    cancelAnimationFrame(frame);
    lastClock = performance.now();
  };

  show(SESSION[0], stepStart, false);
  size();
  start();

  new ResizeObserver(() => {
    size();
    start();
  }).observe(sceneEl);
  new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting);
    if (onScreen) start();
    else stop();
  }).observe(root);
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  reduced.addEventListener("change", start);
  watchTheme(() => {
    palette = readPalette(root);
    start();
  });
}

for (const root of document.querySelectorAll<HTMLElement>("[data-island]")) mount(root);

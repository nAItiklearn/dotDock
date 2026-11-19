import { hash } from "../hash";
import type { Phase } from "../protocol";

/** Every state icon lives on a 7 by 7 lattice. Pure functions, so frames can be tested without a canvas. */
export const LATTICE = 7;
const MID = 3;
const TAU = Math.PI * 2;

export type Tone = "neutral" | "accent" | "success" | "danger" | "dim";

export type IconKind =
  | "thinking"
  | "reading"
  | "searching"
  | "editing"
  | "running"
  | "waiting"
  | "done"
  | "paused"
  | "limit"
  | "error"
  | "stopped";

/** The single accent-coloured "recording LED" dot of a working state. */
export interface Lead {
  readonly c: number;
  readonly r: number;
  /** Brightness 0..1, replaces the lattice value for this cell. */
  readonly v: number;
}

export interface IconSpec {
  readonly tone: Tone;
  /** Seconds after which the animation repeats exactly. Null for icons that play once and then hold. */
  readonly period: number | null;
  /** Time at which the icon shows its most readable pose; used when motion is reduced. */
  readonly staticT: number;
  /** Brightness 0..1 of lattice cell (c, r) at time t seconds since the state began. */
  readonly cell: (t: number, c: number, r: number) => number;
  readonly lead: (t: number) => Lead | null;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const wrap = (t: number, period: number): number => ((t % period) + period) % period;
const smooth = (phase: number): number => 0.5 - 0.5 * Math.cos(TAU * phase);

const none = (): null => null;

const THINKING_PERIOD = 2;
const thinking: IconSpec = {
  tone: "neutral",
  period: THINKING_PERIOD,
  staticT: 0.8,
  cell: (t, c, r) => {
    const ring = Math.max(Math.abs(c - MID), Math.abs(r - MID));
    const wave = (wrap(t, THINKING_PERIOD) / THINKING_PERIOD) * 5.2;
    const crest = Math.max(0, 1 - Math.abs(ring - wave) * 0.85) * (1 - wave / 6.5);
    return clamp01(ring === 0 ? Math.max(crest, 0.5) : crest);
  },
  lead: () => ({ c: MID, r: MID, v: 1 }),
};

const TEXT_ROWS: readonly (number | undefined)[] = [undefined, 5, undefined, 4, undefined, 5, undefined];

const READING_PERIOD = 2.4;
const readingScan = (t: number): number => (wrap(t, READING_PERIOD) / READING_PERIOD) * 8 - 0.5;
const reading: IconSpec = {
  tone: "neutral",
  period: READING_PERIOD,
  staticT: 0.9,
  cell: (t, c, r) => {
    const band = Math.max(0, 1 - Math.abs(r - readingScan(t)) / 1.1);
    const length = TEXT_ROWS[r];
    const onLine = length !== undefined && c >= 1 && c <= length;
    return clamp01(onLine ? 0.5 + 0.5 * band : 0.1 * band);
  },
  lead: (t) => ({ c: 0, r: Math.min(LATTICE - 1, Math.max(0, Math.round(readingScan(t)))), v: 1 }),
};

const SEARCH_PERIOD = 2.4;
const SEARCH_RADIUS = 3.3;
const SEARCH_TRAIL = 2.4;
const searching: IconSpec = {
  tone: "neutral",
  period: SEARCH_PERIOD,
  staticT: 0.6,
  cell: (t, c, r) => {
    const dx = c - MID;
    const dy = r - MID;
    const dist = Math.hypot(dx, dy);
    if (dist > SEARCH_RADIUS) return 0;
    if (dist === 0) return 0.35;
    const sweep = (wrap(t, SEARCH_PERIOD) / SEARCH_PERIOD) * TAU;
    const behind = wrap(sweep - Math.atan2(dy, dx), TAU);
    const trail = behind < SEARCH_TRAIL ? Math.pow(1 - behind / SEARCH_TRAIL, 1.6) : 0;
    return clamp01(Math.max(dist >= 2.6 ? 0.2 : 0, trail));
  },
  lead: (t) => {
    const sweep = (wrap(t, SEARCH_PERIOD) / SEARCH_PERIOD) * TAU;
    return { c: MID + Math.round(2 * Math.cos(sweep)), r: MID + Math.round(2 * Math.sin(sweep)), v: 1 };
  },
};

const EDIT_PERIOD = 4;
const EDIT_ROWS = [1, 3, 5] as const;
const EDIT_LENGTHS = [5, 4, 5] as const;
const EDIT_ROW_SECONDS = 1;
const EDIT_CELLS_PER_SECOND = 6;
const EDIT_HOLD_UNTIL = 3.5;
const editFade = (tc: number): number => (tc < EDIT_HOLD_UNTIL ? 1 : clamp01(1 - (tc - EDIT_HOLD_UNTIL) / (EDIT_PERIOD - EDIT_HOLD_UNTIL)));
const typedCells = (tc: number, line: number): number =>
  Math.min(EDIT_LENGTHS[line] ?? 0, Math.max(0, Math.floor((tc - line * EDIT_ROW_SECONDS) * EDIT_CELLS_PER_SECOND)));
const editing: IconSpec = {
  tone: "neutral",
  period: EDIT_PERIOD,
  staticT: 3.2,
  cell: (t, c, r) => {
    const line = EDIT_ROWS.findIndex((row) => row === r);
    if (line < 0 || c < 1) return 0;
    const tc = wrap(t, EDIT_PERIOD);
    return c <= typedCells(tc, line) ? 0.9 * editFade(tc) : 0;
  },
  lead: (t) => {
    const tc = wrap(t, EDIT_PERIOD);
    let line = 0;
    EDIT_ROWS.forEach((_, i) => {
      if (tc >= i * EDIT_ROW_SECONDS) line = i;
    });
    const c = 1 + typedCells(tc, line);
    const visible = Math.floor(tc * 2.5) % 2 === 0;
    return { c: Math.min(LATTICE - 1, c), r: EDIT_ROWS[line] ?? 1, v: (visible ? 1 : 0.15) * editFade(tc) };
  },
};

const RUN_STEP = 0.16;
const RUN_PERIOD = RUN_STEP * 8;
const RUN_BLINK = RUN_PERIOD / 2;
const CHEVRON: ReadonlySet<number> = new Set([0 * 7 + 1, 1 * 7 + 2, 2 * 7 + 3, 1 * 7 + 4, 0 * 7 + 5]);
const running: IconSpec = {
  tone: "neutral",
  period: RUN_PERIOD,
  staticT: 0.2,
  cell: (t, c, r) => {
    if (CHEVRON.has(c * LATTICE + r)) return 0.95;
    if (c < 5) return 0;
    const step = Math.floor(wrap(t, RUN_PERIOD) / RUN_STEP);
    const h = hash((r + step) % 8);
    if (h % 3 === 0) return 0;
    const length = 1 + ((h >>> 2) % 2);
    return c < 5 + length ? 0.55 : 0;
  },
  lead: (t) => ({ c: 3, r: 3, v: wrap(t, RUN_BLINK) < RUN_BLINK * 0.62 ? 1 : 0.08 }),
};

const KNOCK_PERIOD = 1.8;
const KNOCK_STARTS = [0, 0.3] as const;
const KNOCK_LIFE = 0.9;
const KNOCK_REACH = 3.6;
const waiting: IconSpec = {
  tone: "accent",
  period: KNOCK_PERIOD,
  staticT: 0.35,
  cell: (t, c, r) => {
    const tc = wrap(t, KNOCK_PERIOD);
    const dist = Math.hypot(c - MID, r - MID);
    if (dist === 0) return 0.7;
    let best = 0;
    for (const start of KNOCK_STARTS) {
      const age = tc - start;
      if (age < 0 || age >= KNOCK_LIFE) continue;
      const reach = (age / KNOCK_LIFE) * KNOCK_REACH;
      best = Math.max(best, Math.max(0, 1 - Math.abs(dist - reach) * 1.2) * (1 - age / KNOCK_LIFE));
    }
    return clamp01(best);
  },
  lead: (t) => {
    const tc = wrap(t, KNOCK_PERIOD);
    const struck = KNOCK_STARTS.some((start) => tc - start >= 0 && tc - start < 0.15);
    return { c: MID, r: MID, v: struck ? 1 : 0.7 };
  },
};

/** Cells of the ring, in the order a clockwise sweep from twelve o'clock would reach them. */
const RING: readonly (readonly [number, number])[] = Array.from({ length: LATTICE * LATTICE }, (_, i) => [i % LATTICE, Math.floor(i / LATTICE)] as const)
  .filter(([c, r]) => {
    const dist = Math.hypot(c - MID, r - MID);
    return dist >= 2.6 && dist <= 3.4;
  })
  .sort(([ac, ar], [bc, br]) => clockwise(ac, ar) - clockwise(bc, br));
function clockwise(c: number, r: number): number {
  return wrap(Math.atan2(c - MID, MID - r), TAU);
}
const CHECK: readonly (readonly [number, number])[] = [
  [2, 3],
  [3, 4],
  [4, 3],
  [5, 2],
];
const RING_STEP = 0.035;
const CHECK_STEP = 0.07;
const CHECK_START = RING_STEP * RING.length;
const CHECK_DONE = CHECK_START + CHECK_STEP * CHECK.length;
const CHECK_BREATH = 3;
const done: IconSpec = {
  tone: "success",
  period: null,
  staticT: CHECK_DONE,
  cell: (t, c, r) => {
    const ring = RING.findIndex(([cc, rr]) => cc === c && rr === r);
    const check = CHECK.findIndex(([cc, rr]) => cc === c && rr === r);
    if (ring < 0 && check < 0) return 0;
    const drawn = ring >= 0 ? clamp01((t - ring * RING_STEP) / RING_STEP) : clamp01((t - CHECK_START - check * CHECK_STEP) / CHECK_STEP);
    const hold = t > CHECK_DONE ? 1 - 0.18 * smooth((t - CHECK_DONE) / CHECK_BREATH) : 1;
    return drawn * hold;
  },
  lead: none,
};

const PAUSE_PERIOD = 3.2;
const paused: IconSpec = {
  tone: "dim",
  period: PAUSE_PERIOD,
  staticT: PAUSE_PERIOD / 2,
  cell: (t, c, r) => (c === 2 || c === 4) && r >= 1 && r <= 5 ? 0.5 + 0.3 * smooth(t / PAUSE_PERIOD) : 0,
  lead: none,
};

const GAUGE_ROWS = 5;
const GAUGE_DRAIN_FROM = 0.3;
const GAUGE_DRAIN_STEP = 0.4;
const GAUGE_FADE = 0.2;
const GAUGE_BLINK_FROM = GAUGE_DRAIN_FROM + (GAUGE_ROWS - 1) * GAUGE_DRAIN_STEP + GAUGE_FADE;
const GAUGE_BLINK = 0.8;
const limit: IconSpec = {
  tone: "danger",
  period: null,
  staticT: GAUGE_BLINK_FROM + 0.3,
  cell: (t, c, r) => {
    if (r < 1 || r > GAUGE_ROWS) return 0;
    if (c === 1 || c === 5) return 0.2;
    if (c < 2 || c > 4) return 0;
    const row = r - 1;
    if (row < GAUGE_ROWS - 1) return 1 - clamp01((t - (GAUGE_DRAIN_FROM + row * GAUGE_DRAIN_STEP)) / GAUGE_FADE);
    if (t < GAUGE_BLINK_FROM) return 1;
    return wrap(t - GAUGE_BLINK_FROM, GAUGE_BLINK) < GAUGE_BLINK * 0.6 ? 1 : 0.2;
  },
  lead: none,
};

const GLITCH_PERIOD = 1.7;
const GLITCH_LENGTH = 0.18;
const isX = (c: number, r: number): boolean => c >= 1 && c <= 5 && r >= 1 && r <= 5 && (c === r || c + r === 6);
const error: IconSpec = {
  tone: "danger",
  period: GLITCH_PERIOD,
  staticT: 0.9,
  cell: (t, c, r) => {
    const tc = wrap(t, GLITCH_PERIOD);
    if (tc >= GLITCH_LENGTH) return isX(c, r) ? 0.95 : 0;
    const seed = Math.floor(tc * 40);
    const glitchRow = 1 + (hash(seed) % 5);
    const shift = hash(seed + 7) % 2 === 0 ? 1 : -1;
    const source = r === glitchRow ? c - shift : c;
    if (!isX(source, r)) return 0;
    return hash(seed * 13 + c) % 2 === 0 ? 0.95 : 0.55;
  },
  lead: none,
};

const STOPPED_PERIOD = 4;
const stopped: IconSpec = {
  tone: "dim",
  period: STOPPED_PERIOD,
  staticT: STOPPED_PERIOD / 2,
  cell: (t, c, r) => (c === MID && r === MID ? 0.2 + 0.6 * smooth(t / STOPPED_PERIOD) : 0),
  lead: none,
};

export const ICONS: Readonly<Record<IconKind, IconSpec>> = {
  thinking,
  reading,
  searching,
  editing,
  running,
  waiting,
  done,
  paused,
  limit,
  error,
  stopped,
};

/** Icon for a session phase. `idle` never reaches the island as a session, so it borrows the standby dot. */
export function iconKindFor(phase: Phase): IconKind {
  return phase === "idle" ? "stopped" : phase;
}

import { MS_PER_MINUTE } from "./format";

export type TimerMode = "countdown" | "stopwatch" | "pomodoro";
export type TimerStatus = "idle" | "running" | "paused" | "done";
export type PomodoroPhase = "focus" | "short" | "long";

/** Everything needed to rebuild the timer after a restart. Times are wall-clock epoch milliseconds. */
export interface TimerState {
  readonly mode: TimerMode;
  readonly status: TimerStatus;
  /** When the current run segment began; null unless running. */
  readonly startedAt: number | null;
  /** Time banked before the current segment, in ms. */
  readonly bankedMs: number;
  /** Length of a plain countdown, in ms. */
  readonly countdownMs: number;
  readonly phase: PomodoroPhase;
  /** Focus sessions finished since the last long break. */
  readonly focusDone: number;
}

export interface PomodoroPlan {
  readonly focusMs: number;
  readonly shortBreakMs: number;
  readonly longBreakMs: number;
  readonly sessionsBeforeLongBreak: number;
}

export const COUNTDOWN_STEP_MS = 5 * MS_PER_MINUTE;
export const MIN_COUNTDOWN_MS = MS_PER_MINUTE;
export const MAX_COUNTDOWN_MS = 180 * MS_PER_MINUTE;
export const DEFAULT_COUNTDOWN_MS = 10 * MS_PER_MINUTE;

export const INITIAL_TIMER: TimerState = {
  mode: "countdown",
  status: "idle",
  startedAt: null,
  bankedMs: 0,
  countdownMs: DEFAULT_COUNTDOWN_MS,
  phase: "focus",
  focusDone: 0,
};

/** Time the timer has run so far. */
export function elapsedMs(state: TimerState, now: number): number {
  const live = state.status === "running" && state.startedAt !== null ? Math.max(0, now - state.startedAt) : 0;
  return state.bankedMs + live;
}

export function phaseMs(plan: PomodoroPlan, phase: PomodoroPhase): number {
  return phase === "focus" ? plan.focusMs : phase === "short" ? plan.shortBreakMs : plan.longBreakMs;
}

/** Total length of what is being timed, or null for a stopwatch (it counts up forever). */
export function targetMs(state: TimerState, plan: PomodoroPlan): number | null {
  if (state.mode === "stopwatch") return null;
  return state.mode === "countdown" ? state.countdownMs : phaseMs(plan, state.phase);
}

/** Time left, never negative; null for a stopwatch. */
export function remainingMs(state: TimerState, plan: PomodoroPlan, now: number): number | null {
  const target = targetMs(state, plan);
  return target === null ? null : Math.max(0, target - elapsedMs(state, now));
}

/** 0..1 of the target used up; stopwatches sweep once a minute. */
export function progress(state: TimerState, plan: PomodoroPlan, now: number): number {
  const target = targetMs(state, plan);
  const elapsed = elapsedMs(state, now);
  if (target === null) return (elapsed % MS_PER_MINUTE) / MS_PER_MINUTE;
  return target > 0 ? Math.min(1, elapsed / target) : 1;
}

export function start(state: TimerState, now: number): TimerState {
  if (state.status === "running") return state;
  return { ...state, status: "running", startedAt: now };
}

export function pause(state: TimerState, now: number): TimerState {
  if (state.status !== "running") return state;
  return { ...state, status: "paused", startedAt: null, bankedMs: elapsedMs(state, now) };
}

export function reset(state: TimerState): TimerState {
  return { ...state, status: "idle", startedAt: null, bankedMs: 0 };
}

export function setMode(state: TimerState, mode: TimerMode): TimerState {
  return state.mode === mode ? state : { ...reset(state), mode };
}

/** Changes the countdown length in whole steps; only while nothing is running. */
export function adjustCountdown(state: TimerState, deltaMs: number): TimerState {
  if (state.mode !== "countdown" || state.status === "running" || state.status === "paused") return state;
  const next = Math.min(MAX_COUNTDOWN_MS, Math.max(MIN_COUNTDOWN_MS, state.countdownMs + deltaMs));
  return { ...reset(state), countdownMs: next };
}

/** Which phase follows a finished one. A long break comes after `sessionsBeforeLongBreak` focus sessions. */
export function nextPhase(
  phase: PomodoroPhase,
  focusDone: number,
  sessionsBeforeLongBreak: number,
): { phase: PomodoroPhase; focusDone: number } {
  if (phase !== "focus") return { phase: "focus", focusDone: phase === "long" ? 0 : focusDone };
  const done = focusDone + 1;
  return done >= sessionsBeforeLongBreak ? { phase: "long", focusDone: done } : { phase: "short", focusDone: done };
}

/** Skips to the next pomodoro phase, ready to start. */
export function advancePhase(state: TimerState, plan: PomodoroPlan): TimerState {
  const next = nextPhase(state.phase, state.focusDone, plan.sessionsBeforeLongBreak);
  return { ...reset(state), phase: next.phase, focusDone: next.focusDone };
}

/**
 * Called as time passes. When a running timer has used up its target it finishes: a countdown stops
 * at "done", a pomodoro moves to the next phase and waits. Returns the same object when nothing changed.
 */
export function settle(state: TimerState, plan: PomodoroPlan, now: number): TimerState {
  if (state.status !== "running") return state;
  const left = remainingMs(state, plan, now);
  if (left === null || left > 0) return state;
  if (state.mode === "pomodoro") return advancePhase(state, plan);
  const target = targetMs(state, plan) ?? 0;
  return { ...state, status: "done", startedAt: null, bankedMs: target };
}

/** True when a finish happened moments ago, so a chime is still worth playing (not after a long absence). */
export function finishedRecently(state: TimerState, plan: PomodoroPlan, now: number, windowMs: number): boolean {
  const target = targetMs(state, plan);
  if (target === null || state.status !== "running" || state.startedAt === null) return false;
  const finishedAt = state.startedAt + (target - state.bankedMs);
  return now - finishedAt <= windowMs;
}

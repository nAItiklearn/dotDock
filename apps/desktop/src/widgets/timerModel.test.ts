import { describe, expect, it } from "vitest";
import {
  INITIAL_TIMER,
  MAX_COUNTDOWN_MS,
  MIN_COUNTDOWN_MS,
  adjustCountdown,
  advancePhase,
  elapsedMs,
  finishedRecently,
  nextPhase,
  pause,
  progress,
  remainingMs,
  reset,
  setMode,
  settle,
  start,
  type PomodoroPhase,
  type PomodoroPlan,
  type TimerState,
} from "./timerModel";

const MIN = 60_000;
const PLAN: PomodoroPlan = { focusMs: 25 * MIN, shortBreakMs: 5 * MIN, longBreakMs: 15 * MIN, sessionsBeforeLongBreak: 4 };
const T0 = 1_000_000;

const countdown = (ms: number): TimerState => ({ ...INITIAL_TIMER, countdownMs: ms });

describe("running and pausing", () => {
  it("counts only the time spent running", () => {
    let t = start(countdown(10 * MIN), T0);
    expect(elapsedMs(t, T0 + 30_000)).toBe(30_000);
    t = pause(t, T0 + 30_000);
    expect(elapsedMs(t, T0 + 999_999)).toBe(30_000);
    t = start(t, T0 + 100_000);
    expect(elapsedMs(t, T0 + 110_000)).toBe(40_000);
  });

  it("survives a restart: the stored state alone gives the right time", () => {
    const stored = JSON.parse(JSON.stringify(start(countdown(10 * MIN), T0))) as TimerState;
    expect(remainingMs(stored, PLAN, T0 + 4 * MIN)).toBe(6 * MIN);
  });

  it("ignores start while running and pause while not running", () => {
    const running = start(countdown(MIN), T0);
    expect(start(running, T0 + 5000)).toBe(running);
    const idle = countdown(MIN);
    expect(pause(idle, T0)).toBe(idle);
  });

  it("never reports negative remaining time", () => {
    const t = start(countdown(MIN), T0);
    expect(remainingMs(t, PLAN, T0 + 5 * MIN)).toBe(0);
  });

  it("resets to the start without losing the chosen length", () => {
    const t = reset(pause(start(countdown(7 * MIN), T0), T0 + MIN));
    expect(t.status).toBe("idle");
    expect(t.bankedMs).toBe(0);
    expect(t.countdownMs).toBe(7 * MIN);
  });
});

describe("modes", () => {
  it("has no remaining time for a stopwatch, and sweeps once a minute", () => {
    const t = start(setMode(INITIAL_TIMER, "stopwatch"), T0);
    expect(remainingMs(t, PLAN, T0 + 5000)).toBeNull();
    expect(progress(t, PLAN, T0 + 30_000)).toBeCloseTo(0.5);
    expect(progress(t, PLAN, T0 + 90_000)).toBeCloseTo(0.5);
  });

  it("switching mode stops what was running", () => {
    const t = setMode(start(countdown(MIN), T0), "pomodoro");
    expect(t.status).toBe("idle");
    expect(t.mode).toBe("pomodoro");
    expect(setMode(t, "pomodoro")).toBe(t);
  });

  it("measures progress against the target", () => {
    const t = start(countdown(10 * MIN), T0);
    expect(progress(t, PLAN, T0 + 5 * MIN)).toBeCloseTo(0.5);
    expect(progress(t, PLAN, T0 + 20 * MIN)).toBe(1);
  });
});

describe("countdown length", () => {
  it("adjusts in steps within limits while idle", () => {
    const base = countdown(10 * MIN);
    expect(adjustCountdown(base, 5 * MIN).countdownMs).toBe(15 * MIN);
    expect(adjustCountdown(base, -60 * MIN).countdownMs).toBe(MIN_COUNTDOWN_MS);
    expect(adjustCountdown(base, 999 * MIN).countdownMs).toBe(MAX_COUNTDOWN_MS);
  });

  it("is locked while running or paused, and in other modes", () => {
    const running = start(countdown(10 * MIN), T0);
    expect(adjustCountdown(running, 5 * MIN)).toBe(running);
    const paused = pause(running, T0 + 1000);
    expect(adjustCountdown(paused, 5 * MIN)).toBe(paused);
    const pomodoro = setMode(INITIAL_TIMER, "pomodoro");
    expect(adjustCountdown(pomodoro, 5 * MIN)).toBe(pomodoro);
  });
});

describe("settle", () => {
  it("leaves a timer with time left alone", () => {
    const t = start(countdown(10 * MIN), T0);
    expect(settle(t, PLAN, T0 + MIN)).toBe(t);
  });

  it("finishes a countdown at done with the full time banked", () => {
    const t = settle(start(countdown(MIN), T0), PLAN, T0 + MIN + 10);
    expect(t.status).toBe("done");
    expect(t.startedAt).toBeNull();
    expect(remainingMs(t, PLAN, T0 + 10 * MIN)).toBe(0);
  });

  it("moves a finished pomodoro focus to a break and waits for the user", () => {
    const running = start(setMode(INITIAL_TIMER, "pomodoro"), T0);
    const next = settle(running, PLAN, T0 + 25 * MIN);
    expect(next).toMatchObject({ status: "idle", phase: "short", focusDone: 1, bankedMs: 0 });
  });

  it("only chimes for a finish that just happened", () => {
    const t = start(countdown(MIN), T0);
    expect(finishedRecently(t, PLAN, T0 + MIN + 1000, 3000)).toBe(true);
    expect(finishedRecently(t, PLAN, T0 + 30 * MIN, 3000)).toBe(false);
    expect(finishedRecently(countdown(MIN), PLAN, T0, 3000)).toBe(false);
  });
});

describe("pomodoro phases", () => {
  it("takes a long break after the configured number of focus sessions", () => {
    let phase: PomodoroPhase = "focus";
    let done = 0;
    const order: string[] = [];
    for (let i = 0; i < 8; i++) {
      const next = nextPhase(phase, done, 4);
      phase = next.phase;
      done = next.focusDone;
      order.push(phase);
    }
    expect(order).toEqual(["short", "focus", "short", "focus", "short", "focus", "long", "focus"]);
    expect(done).toBe(0);
  });

  it("skipping a phase moves on without banking time", () => {
    const t = advancePhase(start(setMode(INITIAL_TIMER, "pomodoro"), T0), PLAN);
    expect(t).toMatchObject({ status: "idle", phase: "short", focusDone: 1 });
  });
});

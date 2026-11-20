import { describe, expect, it } from "vitest";
import { MS_PER_MINUTE } from "../../widgets/format";
import { INITIAL_TIMER, type TimerState } from "../../widgets/timerModel";
import { FOCUS_PLAN, focusView } from "./focus";

const NOW = 1_000_000_000;
const pomodoro = (patch: Partial<TimerState>): TimerState => ({ ...INITIAL_TIMER, mode: "pomodoro", ...patch });
const MIN = MS_PER_MINUTE;

describe("focusView", () => {
  it("starts as session one of four, with the whole focus time ahead", () => {
    const view = focusView(pomodoro({}), FOCUS_PLAN, NOW);
    expect(view).toMatchObject({ phase: "focus", status: "idle", session: 1, sessions: 4, remainingMs: 25 * MIN, totalMs: 25 * MIN, busy: false });
  });

  it("counts down while running", () => {
    const view = focusView(pomodoro({ status: "running", startedAt: NOW - 7 * MIN }), FOCUS_PLAN, NOW);
    expect(view.status).toBe("running");
    expect(view.remainingMs).toBe(18 * MIN);
  });

  it("holds its time while paused", () => {
    const view = focusView(pomodoro({ status: "paused", bankedMs: 11 * MIN, focusDone: 1 }), FOCUS_PLAN, NOW + 99 * MIN);
    expect(view).toMatchObject({ status: "paused", remainingMs: 14 * MIN, session: 2 });
  });

  it("never reads negative if the timer ran past its end before it was settled", () => {
    expect(focusView(pomodoro({ status: "running", startedAt: NOW - 40 * MIN }), FOCUS_PLAN, NOW).remainingMs).toBe(0);
  });

  it("says which break follows: short until the last session, then long", () => {
    expect(focusView(pomodoro({ focusDone: 0 }), FOCUS_PLAN, NOW)).toMatchObject({ breakMs: 5 * MIN, breakIsLong: false });
    expect(focusView(pomodoro({ focusDone: 3 }), FOCUS_PLAN, NOW)).toMatchObject({ breakMs: 15 * MIN, breakIsLong: true, session: 4 });
  });

  it("shows the session just finished during a break", () => {
    expect(focusView(pomodoro({ phase: "short", focusDone: 2 }), FOCUS_PLAN, NOW)).toMatchObject({ phase: "short", session: 2, totalMs: 5 * MIN });
    expect(focusView(pomodoro({ phase: "long", focusDone: 4 }), FOCUS_PLAN, NOW)).toMatchObject({ phase: "long", session: 4, totalMs: 15 * MIN, breakIsLong: true });
  });

  it("never claims a session past the last", () => {
    expect(focusView(pomodoro({ focusDone: 9 }), FOCUS_PLAN, NOW).session).toBe(4);
  });

  it("shows another timer mode as an idle focus session, and marks it busy only while it runs", () => {
    const countdown: TimerState = { ...INITIAL_TIMER, mode: "countdown", status: "running", startedAt: NOW - MIN };
    expect(focusView(countdown, FOCUS_PLAN, NOW)).toMatchObject({ status: "idle", busy: true, remainingMs: 25 * MIN });
    expect(focusView({ ...countdown, status: "paused", startedAt: null }, FOCUS_PLAN, NOW).busy).toBe(true);
    expect(focusView({ ...countdown, status: "idle", startedAt: null }, FOCUS_PLAN, NOW).busy).toBe(false);
    expect(focusView({ ...countdown, status: "done", startedAt: null }, FOCUS_PLAN, NOW).busy).toBe(false);
  });

  it("reads a finished pomodoro as idle", () => {
    expect(focusView(pomodoro({ status: "done" }), FOCUS_PLAN, NOW).status).toBe("idle");
  });
});

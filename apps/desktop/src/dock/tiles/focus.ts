import { MS_PER_MINUTE } from "../../widgets/format";
import { elapsedMs, phaseMs, type PomodoroPhase, type PomodoroPlan, type TimerState } from "../../widgets/timerModel";

/** The dock's own pomodoro plan: the one the home-screen timer starts with. */
export const FOCUS_PLAN: PomodoroPlan = {
  focusMs: 25 * MS_PER_MINUTE,
  shortBreakMs: 5 * MS_PER_MINUTE,
  longBreakMs: 15 * MS_PER_MINUTE,
  sessionsBeforeLongBreak: 4,
};

export type FocusStatus = "idle" | "running" | "paused";

export interface FocusView {
  readonly phase: PomodoroPhase;
  readonly status: FocusStatus;
  /** The focus session in progress or next up, 1-based; during a break, the one just finished. */
  readonly session: number;
  readonly sessions: number;
  readonly remainingMs: number;
  /** Length of the current phase. */
  readonly totalMs: number;
  /** Length of the break that follows the current focus session. */
  readonly breakMs: number;
  readonly breakIsLong: boolean;
  /** Another timer mode is running or paused on the home screen; starting here would replace it. */
  readonly busy: boolean;
}

/** The shared timer as the focus tile reads it. A timer in another mode shows as an idle focus session, marked busy while it runs. */
export function focusView(timer: TimerState, plan: PomodoroPlan, now: number): FocusView {
  const pomodoro = timer.mode === "pomodoro";
  const phase = pomodoro ? timer.phase : "focus";
  const focusDone = pomodoro ? timer.focusDone : 0;
  const totalMs = phaseMs(plan, phase);
  const status: FocusStatus = pomodoro && timer.status !== "done" ? timer.status : "idle";
  const session = Math.min(plan.sessionsBeforeLongBreak, phase === "focus" ? focusDone + 1 : Math.max(1, focusDone));
  const breakIsLong = phase === "focus" ? focusDone + 1 >= plan.sessionsBeforeLongBreak : phase === "long";
  return {
    phase,
    status,
    session,
    sessions: plan.sessionsBeforeLongBreak,
    remainingMs: pomodoro ? Math.max(0, totalMs - elapsedMs(timer, now)) : totalMs,
    totalMs,
    breakMs: breakIsLong ? plan.longBreakMs : plan.shortBreakMs,
    breakIsLong,
    busy: !pomodoro && (timer.status === "running" || timer.status === "paused"),
  };
}

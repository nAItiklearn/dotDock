import { create } from "zustand";
import { persist } from "zustand/middleware";
import { persistOptions, syncAcrossWindows } from "./persist";
import {
  adjustCountdown,
  advancePhase,
  INITIAL_TIMER,
  pause,
  reset,
  setMode,
  settle,
  start,
  type PomodoroPlan,
  type TimerMode,
  type TimerState,
} from "./timerModel";

const NAME = "timer";
const VERSION = 1;

interface TimerStore {
  readonly timer: TimerState;
  start: () => void;
  pause: () => void;
  reset: () => void;
  setMode: (mode: TimerMode) => void;
  adjust: (deltaMs: number) => void;
  skipPhase: (plan: PomodoroPlan) => void;
  /** Finishes a timer whose time is up. Safe to call every second. */
  settle: (plan: PomodoroPlan) => void;
}

const apply = (change: (t: TimerState) => TimerState) => (s: TimerStore) => {
  const timer = change(s.timer);
  return timer === s.timer ? s : { timer };
};

export const useTimerStore = create<TimerStore>()(
  persist(
    (set) => ({
      timer: INITIAL_TIMER,
      start: () => set(apply((t) => start(t, Date.now()))),
      pause: () => set(apply((t) => pause(t, Date.now()))),
      reset: () => set(apply(reset)),
      setMode: (mode) => set(apply((t) => setMode(t, mode))),
      adjust: (deltaMs) => set(apply((t) => adjustCountdown(t, deltaMs))),
      skipPhase: (plan) => set(apply((t) => advancePhase(t, plan))),
      settle: (plan) => set(apply((t) => settle(t, plan, Date.now()))),
    }),
    persistOptions<TimerStore, { timer: TimerState }>({
      name: NAME,
      version: VERSION,
      partialize: (s) => ({ timer: s.timer }),
    }),
  ),
);

syncAcrossWindows(NAME, useTimerStore);

import { MS_PER_DAY, MS_PER_MINUTE } from "../../widgets/format";
import { INITIAL_TIMER, type TimerState } from "../../widgets/timerModel";
import { useTimerStore } from "../../widgets/timerStore";
import { formatDue } from "../../widgets/todoModel";
import { useTodoStore } from "../../widgets/todoStore";

/** DEV ONLY. States of the shared stores that the dock's focus and reminder tiles read, so every one can be looked at. */

export type FocusSeed = "idle" | "running" | "paused" | "break" | "other-timer";

export function seedReminders(): void {
  const today = Date.now();
  const due = (offsetDays: number): string => formatDue(new Date(today + offsetDays * MS_PER_DAY));
  useTodoStore.setState({
    items: [
      { id: "seed-1", text: "Send the invoice to Fabrikam", done: false, due: due(-1) },
      { id: "seed-2", text: "Book the dentist", done: false, due: due(0) },
      { id: "seed-3", text: "Read the dock notes", done: false, due: null },
      { id: "seed-4", text: "Renew the passport", done: false, due: due(9) },
      { id: "seed-5", text: "Water the plants", done: true, due: null },
    ],
  });
}

const pomodoro = (patch: Partial<TimerState>): TimerState => ({ ...INITIAL_TIMER, mode: "pomodoro", ...patch });

export function seedFocus(seed: FocusSeed): void {
  const now = Date.now();
  const timer: TimerState =
    seed === "running"
      ? pomodoro({ status: "running", startedAt: now - 7 * MS_PER_MINUTE })
      : seed === "paused"
        ? pomodoro({ status: "paused", bankedMs: 11 * MS_PER_MINUTE, focusDone: 1 })
        : seed === "break"
          ? pomodoro({ phase: "short", focusDone: 2 })
          : seed === "other-timer"
            ? { ...INITIAL_TIMER, mode: "countdown", status: "running", startedAt: now - MS_PER_MINUTE }
            : pomodoro({});
  useTimerStore.setState({ timer });
}

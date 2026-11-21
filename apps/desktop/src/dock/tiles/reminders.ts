import { displayOrder, dueState, parseDue, type DueState, type TodoItem } from "../../widgets/todoModel";

export interface ReminderRow {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
  /** The due date as a Date, for display. */
  readonly due: Date | null;
  readonly state: DueState | null;
}

export interface RemindersView {
  /** Open reminders in the user's order, then finished ones. */
  readonly rows: readonly ReminderRow[];
  readonly open: number;
  readonly overdue: number;
  readonly dueToday: number;
}

const stateRank: Record<DueState | "none", number> = { overdue: 0, today: 1, upcoming: 2, none: 3 };

/**
 * The to-do list the home screen shares, as the dock shows it: open items with a date that needs attention
 * first (overdue, then today), then the rest in the user's own order, then finished ones.
 */
export function remindersView(items: readonly TodoItem[], today: Date): RemindersView {
  const ordered = displayOrder(items);
  const rows = ordered.map((item): ReminderRow => ({
    id: item.id,
    text: item.text,
    done: item.done,
    due: item.due === null ? null : parseDue(item.due),
    state: item.done ? null : dueState(item.due, today),
  }));
  const open = rows.filter((r) => !r.done);
  const rank = (r: ReminderRow): number => stateRank[r.state ?? "none"];
  // Array.prototype.sort is stable, so items of one rank keep the user's order.
  const urgent = open.filter((r) => rank(r) <= stateRank.today).sort((a, b) => rank(a) - rank(b));
  const rest = open.filter((r) => rank(r) > stateRank.today);
  return {
    rows: [...urgent, ...rest, ...rows.filter((r) => r.done)],
    open: open.length,
    overdue: open.filter((r) => r.state === "overdue").length,
    dueToday: open.filter((r) => r.state === "today").length,
  };
}

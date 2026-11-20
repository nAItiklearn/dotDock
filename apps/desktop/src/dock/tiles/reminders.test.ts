import { describe, expect, it } from "vitest";
import type { TodoItem } from "../../widgets/todoModel";
import { remindersView } from "./reminders";

const TODAY = new Date(2026, 10, 20, 9, 0);
const item = (id: string, due: string | null, done = false): TodoItem => ({ id, text: `Task ${id}`, done, due });

describe("remindersView", () => {
  it("puts overdue first, then today, then the rest in the user's order, then finished ones", () => {
    const view = remindersView(
      [item("plain", null), item("later", "2026-12-01"), item("today", "2026-11-20"), item("late", "2026-11-18"), item("done", null, true), item("also-plain", null)],
      TODAY,
    );
    expect(view.rows.map((r) => r.id)).toEqual(["late", "today", "plain", "later", "also-plain", "done"]);
  });

  it("counts what needs attention", () => {
    const view = remindersView([item("a", "2026-11-19"), item("b", "2026-11-19"), item("c", "2026-11-20"), item("d", null), item("e", "2026-11-19", true)], TODAY);
    expect(view).toMatchObject({ open: 4, overdue: 2, dueToday: 1 });
  });

  it("does not call a finished reminder overdue", () => {
    const row = remindersView([item("e", "2026-11-01", true)], TODAY).rows[0];
    expect(row?.state).toBeNull();
    expect(row?.done).toBe(true);
  });

  it("keeps the due date for display and ignores a date that is not real", () => {
    const rows = remindersView([item("ok", "2026-11-25"), item("bad", "2026-02-30")], TODAY).rows;
    expect(rows.find((r) => r.id === "ok")?.due?.getDate()).toBe(25);
    expect(rows.find((r) => r.id === "bad")?.due).toBeNull();
  });

  it("is empty for an empty list", () => {
    expect(remindersView([], TODAY)).toEqual({ rows: [], open: 0, overdue: 0, dueToday: 0 });
  });

  it("turns overdue into today at midnight without the list changing", () => {
    const list = [item("a", "2026-11-20")];
    expect(remindersView(list, new Date(2026, 10, 20, 23, 59)).dueToday).toBe(1);
    expect(remindersView(list, new Date(2026, 10, 21, 0, 0)).overdue).toBe(1);
  });
});

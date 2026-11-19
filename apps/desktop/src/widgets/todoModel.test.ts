import { describe, expect, it } from "vitest";
import { MAX_ITEMS, MAX_TEXT_LENGTH, addItem, clearDone, displayOrder, dueState, formatDue, moveWithin, parseDue, removeItem, reorderOpen, setDue, toggleItem, type TodoItem } from "./todoModel";
import { MAX_BODY_LENGTH, MAX_TITLE_LENGTH, NOTE_COLORS, clampNoteText, continueList, createNote, nextColor, orderedNotes } from "./notesModel";

const item = (id: string, done = false, due: string | null = null): TodoItem => ({ id, text: id, done, due });
const ids = (items: readonly TodoItem[]): string[] => items.map((i) => i.id);

describe("todo list", () => {
  it("adds trimmed tasks and ignores empty ones", () => {
    expect(addItem([], "  Buy milk  ", "1")).toEqual([{ id: "1", text: "Buy milk", done: false, due: null }]);
    expect(addItem([], "   ", "1")).toEqual([]);
  });

  it("limits the length of a task and the size of the list", () => {
    expect(addItem([], "x".repeat(MAX_TEXT_LENGTH + 50), "1")[0]?.text).toHaveLength(MAX_TEXT_LENGTH);
    const full = Array.from({ length: MAX_ITEMS }, (_, i) => item(String(i)));
    expect(addItem(full, "one more", "x")).toBe(full);
  });

  it("toggles, removes, dates and clears", () => {
    const list = [item("a"), item("b")];
    expect(toggleItem(list, "a")[0]?.done).toBe(true);
    expect(ids(removeItem(list, "a"))).toEqual(["b"]);
    expect(setDue(list, "b", "2026-12-01")[1]?.due).toBe("2026-12-01");
    expect(ids(clearDone([item("a", true), item("b"), item("c", true)]))).toEqual(["b"]);
  });

  it("shows open tasks first, in the user's order, then finished ones", () => {
    expect(ids(displayOrder([item("a", true), item("b"), item("c", true), item("d")]))).toEqual(["b", "d", "a", "c"]);
  });
});

describe("reordering", () => {
  it("moves one element and clamps the target", () => {
    expect(moveWithin(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveWithin(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveWithin(["a", "b", "c"], 0, 99)).toEqual(["b", "c", "a"]);
    expect(moveWithin(["a", "b", "c"], 2, -5)).toEqual(["c", "a", "b"]);
  });

  it("returns the same list when nothing moves", () => {
    const list = ["a", "b"];
    expect(moveWithin(list, 1, 1)).toBe(list);
    expect(moveWithin(list, 5, 0)).toBe(list);
    expect(moveWithin(list, -1, 0)).toBe(list);
  });

  it("reorders open tasks only and keeps finished ones at the end", () => {
    const list = [item("a"), item("b"), item("x", true), item("c")];
    expect(ids(reorderOpen(list, 0, 2))).toEqual(["b", "c", "a", "x"]);
  });

  it("does not touch the list for a no-op move", () => {
    const list = [item("a"), item("b")];
    expect(reorderOpen(list, 0, 0)).toBe(list);
  });
});

describe("due dates", () => {
  it("parses only real calendar dates", () => {
    expect(parseDue("2026-11-19")?.getDate()).toBe(19);
    expect(parseDue("2026-02-30")).toBeNull();
    expect(parseDue("2026-13-01")).toBeNull();
    expect(parseDue("19/11/2026")).toBeNull();
    expect(parseDue("")).toBeNull();
  });

  it("round-trips through the stored format", () => {
    expect(formatDue(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(formatDue(parseDue("2026-11-19") ?? new Date(0))).toBe("2026-11-19");
  });

  it("classifies against today", () => {
    const today = new Date(2026, 10, 19, 15, 30);
    expect(dueState("2026-11-19", today)).toBe("today");
    expect(dueState("2026-11-18", today)).toBe("overdue");
    expect(dueState("2026-11-20", today)).toBe("upcoming");
    expect(dueState("2025-12-31", today)).toBe("overdue");
    expect(dueState(null, today)).toBeNull();
    expect(dueState("garbage", today)).toBeNull();
  });
});

describe("notes", () => {
  it("cycles through every colour and back", () => {
    let color = NOTE_COLORS[0] ?? "plain";
    const seen = new Set<string>();
    for (let i = 0; i < NOTE_COLORS.length; i++) {
      seen.add(color);
      color = nextColor(color);
    }
    expect(seen.size).toBe(NOTE_COLORS.length);
    expect(color).toBe(NOTE_COLORS[0]);
  });

  it("puts pinned notes first and otherwise keeps creation order", () => {
    const a = createNote("a");
    const b = { ...createNote("b"), pinned: true };
    const c = createNote("c");
    const d = { ...createNote("d"), pinned: true };
    expect(orderedNotes([a, b, c, d]).map((n) => n.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("limits title and body length", () => {
    const out = clampNoteText("t".repeat(MAX_TITLE_LENGTH + 5), "b".repeat(MAX_BODY_LENGTH + 5));
    expect(out.title).toHaveLength(MAX_TITLE_LENGTH);
    expect(out.body).toHaveLength(MAX_BODY_LENGTH);
  });

  describe("continueList", () => {
    it("starts the next bullet on Enter", () => {
      expect(continueList("- milk", 6)).toEqual({ value: "- milk\n- ", caret: 9 });
    });

    it("continues in the middle of a text", () => {
      expect(continueList("- a\n- b\nplain", 7)).toEqual({ value: "- a\n- b\n- \nplain", caret: 10 });
    });

    it("ends the list on an empty bullet", () => {
      expect(continueList("- milk\n- ", 9)).toEqual({ value: "- milk\n", caret: 7 });
      expect(continueList("- ", 2)).toEqual({ value: "", caret: 0 });
    });

    it("leaves ordinary lines to the browser", () => {
      expect(continueList("plain", 5)).toBeNull();
      expect(continueList("a - b", 5)).toBeNull();
      expect(continueList("", 0)).toBeNull();
    });
  });
});

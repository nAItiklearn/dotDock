import { describe, expect, it } from "vitest";
import {
  eventMatches,
  findConflicts,
  formatShortcut,
  globalShortcutIssue,
  normalizeShortcut,
  parseShortcut,
  shortcutFromEvent,
  type KeyEventLike,
} from "./shortcuts";

const event = (code: string, key: string, mods: Partial<Pick<KeyEventLike, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">> = {}): KeyEventLike => ({
  code,
  key,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("parsing", () => {
  it("normalises case, aliases and modifier order", () => {
    expect(normalizeShortcut("ctrl+alt+e")).toBe("Ctrl+Alt+E");
    expect(normalizeShortcut("Alt + Ctrl + E")).toBe("Ctrl+Alt+E");
    expect(normalizeShortcut("shift+control+left")).toBe("Ctrl+Shift+Left");
    expect(normalizeShortcut("meta+f5")).toBe("Win+F5");
    expect(normalizeShortcut("Ctrl+Esc")).toBe("Ctrl+Escape");
    expect(normalizeShortcut("Ctrl+,")).toBe("Ctrl+,");
  });

  it("rejects junk", () => {
    for (const bad of ["", "Ctrl+", "Ctrl+Alt", "banana", "Ctrl+Hyper+E", "Ctrl+AB", "F25", "Ctrl+Alt+Ä"]) {
      expect(normalizeShortcut(bad), bad).toBeNull();
    }
  });

  it("is a fixed point of format(parse(x))", () => {
    for (const s of ["Ctrl+Alt+E", "Ctrl+Shift+Win+F12", "Alt+Space", "Ctrl+PageDown"]) {
      const chord = parseShortcut(s);
      expect(chord && formatShortcut(chord)).toBe(s);
    }
  });
});

describe("key events", () => {
  it("uses the physical key so shifted symbols and other layouts behave", () => {
    expect(shortcutFromEvent(event("KeyE", "e", { ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+E");
    expect(shortcutFromEvent(event("KeyZ", "Z", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+Z");
    expect(shortcutFromEvent(event("Digit1", "!", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+1");
    expect(shortcutFromEvent(event("ArrowLeft", "ArrowLeft", { altKey: true }))).toBe("Alt+Left");
    expect(shortcutFromEvent(event("F5", "F5"))).toBe("F5");
    expect(shortcutFromEvent(event("Comma", ",", { ctrlKey: true }))).toBe("Ctrl+,");
    expect(shortcutFromEvent(event("Delete", "Delete"))).toBe("Delete");
  });

  it("returns nothing while only modifiers are held", () => {
    expect(shortcutFromEvent(event("ControlLeft", "Control", { ctrlKey: true }))).toBeNull();
    expect(shortcutFromEvent(event("ShiftLeft", "Shift", { shiftKey: true }))).toBeNull();
  });

  it("matches events against stored shortcuts", () => {
    expect(eventMatches(event("KeyE", "e", { ctrlKey: true, altKey: true }), "Ctrl+Alt+E")).toBe(true);
    expect(eventMatches(event("KeyE", "e", { ctrlKey: true }), "Ctrl+Alt+E")).toBe(false);
    expect(eventMatches(event("KeyE", "e", { ctrlKey: true, altKey: true, shiftKey: true }), "Ctrl+Alt+E")).toBe(false);
  });
});

describe("global hotkey rules", () => {
  it("accepts normal combinations", () => {
    expect(globalShortcutIssue("Ctrl+Alt+E")).toBeNull();
    expect(globalShortcutIssue("Win+Shift+D")).toBeNull();
    expect(globalShortcutIssue("F9")).toBeNull();
  });

  it("refuses a bare key or a shift-only combination, which would break typing", () => {
    expect(globalShortcutIssue("E")).toBe("needs-modifier");
    expect(globalShortcutIssue("Shift+E")).toBe("needs-modifier");
  });

  it("refuses combinations Windows and every app already own", () => {
    for (const s of ["Ctrl+C", "Ctrl+V", "Alt+F4", "Alt+Tab", "Win+L", "Ctrl+Alt+Delete"]) {
      expect(globalShortcutIssue(s), s).toBe("reserved");
    }
  });

  it("flags text that is not a shortcut at all", () => {
    expect(globalShortcutIssue("nonsense")).toBe("invalid");
  });
});

describe("conflicts", () => {
  it("reports every action that shares a binding", () => {
    const conflicts = findConflicts({ a: "Ctrl+Alt+E", b: "Ctrl+Alt+E", c: "Ctrl+Alt+P" });
    expect([...conflicts.keys()].sort()).toEqual(["a", "b"]);
    expect(conflicts.get("a")).toEqual(["b"]);
  });

  it("reports nothing when all bindings are unique", () => {
    expect(findConflicts({ a: "Ctrl+Alt+E", b: "Ctrl+Alt+S" }).size).toBe(0);
  });
});

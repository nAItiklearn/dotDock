import { describe, expect, it } from "vitest";
import { PANEL_KEY, panelShownAtStart, togglesPanel } from "./panelKey";

const press = (code: string, extra: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean; typing: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  typing: false,
  ...extra,
});

describe("the fixture panel's key", () => {
  it("starts hidden, so the dock is judged on its own", () => {
    expect(panelShownAtStart("")).toBe(false);
    expect(panelShownAtStart("?wall=meadow-dots-dark")).toBe(false);
    expect(panelShownAtStart("?panel=0")).toBe(false);
  });

  it("starts shown only when the address asks for it", () => {
    expect(panelShownAtStart("?panel=1")).toBe(true);
  });

  it("is the backquote key, with no modifier", () => {
    expect(PANEL_KEY).toBe("Backquote");
    expect(togglesPanel(press("Backquote"))).toBe(true);
    for (const mod of ["ctrlKey", "altKey", "metaKey"] as const) expect(togglesPanel(press("Backquote", { [mod]: true }))).toBe(false);
    expect(togglesPanel(press("KeyA"))).toBe(false);
  });

  it("types a backquote into a text field instead of hiding the panel", () => {
    expect(togglesPanel(press("Backquote", { typing: true }))).toBe(false);
  });
});

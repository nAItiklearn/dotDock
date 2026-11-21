import { describe, expect, it } from "vitest";
import { createKeyboardArbiter } from "./keyboardFocus";

describe("keyboard arbiter", () => {
  it("asks once when the first holder arrives and releases when the last one leaves", () => {
    const sent: boolean[] = [];
    const a = createKeyboardArbiter((w) => sent.push(w));
    a.hold("editing", true);
    a.hold("typing", true);
    a.hold("editing", true);
    expect(sent).toEqual([true]);
    a.hold("editing", false);
    expect(sent).toEqual([true]);
    expect(a.wanted).toBe(true);
    a.hold("typing", false);
    expect(sent).toEqual([true, false]);
    expect(a.wanted).toBe(false);
  });

  it("a text field losing focus during edit mode keeps the keyboard for edit mode", () => {
    const sent: boolean[] = [];
    const a = createKeyboardArbiter((w) => sent.push(w));
    a.hold("typing", true);
    a.hold("editing", true);
    a.hold("typing", false);
    expect(a.wanted).toBe(true);
    expect(sent).toEqual([true]);
  });

  it("releasing a reason that never held sends nothing", () => {
    const sent: boolean[] = [];
    const a = createKeyboardArbiter((w) => sent.push(w));
    a.hold("menu", false);
    expect(sent).toEqual([]);
  });
});

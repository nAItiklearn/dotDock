import { describe, expect, it } from "vitest";
import { isKey } from "./keys";

describe("isKey", () => {
  it("matches the physical key whatever the layout types", () => {
    expect(isKey({ code: "KeyZ", key: "z" }, "z")).toBe(true);
    expect(isKey({ code: "KeyZ", key: "y" }, "z")).toBe(true);
    expect(isKey({ code: "KeyZ", key: "я" }, "z")).toBe(true);
  });

  it("falls back to the typed letter only when there is no key code", () => {
    expect(isKey({ code: "", key: "z" }, "z")).toBe(true);
    expect(isKey({ code: "", key: "Z" }, "z")).toBe(true);
    expect(isKey({ code: "KeyY", key: "z" }, "z")).toBe(false);
    expect(isKey({ code: "", key: "x" }, "z")).toBe(false);
  });
});

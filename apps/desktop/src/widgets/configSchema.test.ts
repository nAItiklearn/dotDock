import { describe, expect, it } from "vitest";
import { appliesWhenMet, fieldsForSize, normalizeConfig, type ConfigField, type ConfigSchema } from "./configSchema";

const schema: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: {
      type: "string",
      title: "Kind",
      default: "plain",
      replaces: "style",
      oneOf: [
        { const: "plain", title: "Plain" },
        { const: "fancy", title: "Fancy" },
        { const: "loud", title: "Loud" },
      ],
    },
    weight: {
      type: "string",
      title: "Weight",
      default: "soft",
      oneOf: [
        { const: "soft", title: "Soft" },
        { const: "bold", title: "Bold" },
      ],
    },
    width: {
      type: "number",
      title: "Width",
      default: 8,
      minimum: 4,
      maximum: 16,
      multipleOf: 4,
      appliesWhen: [{ kind: ["fancy", "loud"] }],
    },
    label: {
      type: "string",
      title: "Label",
      default: "",
      maxLength: 10,
      appliesWhen: [{ kind: ["fancy"] }],
    },
    corners: {
      type: "number",
      title: "Corners",
      default: 4,
      minimum: 0,
      maximum: 8,
      multipleOf: 4,
      appliesWhen: [{ kind: ["plain"], weight: ["bold"] }, { kind: ["loud"] }],
    },
    big: { type: "boolean", title: "Big", default: false, appliesToSizes: ["l"] },
  },
};

const cfg = (raw: unknown) => normalizeConfig(schema, raw);
const field = (key: string): ConfigField => {
  const found = schema.properties[key];
  if (!found) throw new Error(`no field ${key}`);
  return found;
};

describe("replaces", () => {
  it("reads a setting an older version stored under another key", () => {
    expect(cfg({ style: "fancy" })["kind"]).toBe("fancy");
  });

  it("prefers the current key when both are present", () => {
    expect(cfg({ style: "fancy", kind: "loud" })["kind"]).toBe("loud");
  });

  it("falls back to the default when the old value is not a valid choice", () => {
    expect(cfg({ style: "gaudy" })["kind"]).toBe("plain");
  });

  it("never invents the old key in the result", () => {
    expect(Object.keys(cfg({ style: "fancy" }))).not.toContain("style");
  });
});

describe("appliesWhen", () => {
  it("shows a field only while its condition holds", () => {
    expect(appliesWhenMet(field("width"), cfg({ kind: "plain" }))).toBe(false);
    expect(appliesWhenMet(field("width"), cfg({ kind: "fancy" }))).toBe(true);
  });

  it("shows a field with no condition always", () => {
    expect(appliesWhenMet(field("kind"), cfg({}))).toBe(true);
  });

  it("needs every field inside one clause to match, but only one clause to match", () => {
    const corners = field("corners");
    expect(appliesWhenMet(corners, cfg({ kind: "plain", weight: "bold" }))).toBe(true);
    expect(appliesWhenMet(corners, cfg({ kind: "plain", weight: "soft" }))).toBe(false);
    expect(appliesWhenMet(corners, cfg({ kind: "loud", weight: "soft" }))).toBe(true);
    expect(appliesWhenMet(corners, cfg({ kind: "fancy", weight: "bold" }))).toBe(false);
  });

  it("filters the form's fields by size and by config together", () => {
    const keys = (size: "s" | "l", raw: unknown): string[] => fieldsForSize(schema, size, cfg(raw)).map(([key]) => key);
    expect(keys("s", { kind: "plain" })).toEqual(["kind", "weight"]);
    expect(keys("l", { kind: "fancy" })).toEqual(["kind", "weight", "width", "label", "big"]);
    expect(keys("s", { kind: "loud" })).toEqual(["kind", "weight", "width", "corners"]);
  });

  it("lists every field of the size when no config is given", () => {
    expect(fieldsForSize(schema, "s").map(([key]) => key)).toEqual(["kind", "weight", "width", "label", "corners"]);
  });
});

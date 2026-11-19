import { describe, expect, it } from "vitest";
import { fieldsForSize, normalizeConfig, schemaDefaults, type ConfigSchema } from "./configSchema";
import { LEGACY_KINDS, WIDGETS, defaultSize, getWidget, resolveConfig, resolveSize } from "./registry";

describe("registry", () => {
  it("has the thirteen widgets of the spec plus the photo widget, each with a unique id", () => {
    const ids = WIDGETS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "clock",
      "date",
      "calendar",
      "weather",
      "battery",
      "system",
      "music",
      "photo",
      "quote",
      "fun-fact",
      "notes",
      "todo",
      "timer",
      "world-clocks",
    ]);
  });

  describe.each(WIDGETS.map((w) => [w.id, w] as const))("%s", (_id, def) => {
    it("declares unique, positive sizes", () => {
      const ids = def.sizes.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const s of def.sizes) {
        expect(s.w).toBeGreaterThan(0);
        expect(s.h).toBeGreaterThan(0);
        expect(Number.isInteger(s.w) && Number.isInteger(s.h)).toBe(true);
        expect(s.name.trim()).not.toBe("");
      }
    });

    it("has a default config that its own schema accepts unchanged", () => {
      expect(normalizeConfig(def.settingsSchema, def.defaultConfig)).toEqual(
        Object.fromEntries(Object.keys(def.settingsSchema.properties).map((k) => [k, (def.defaultConfig as Record<string, unknown>)[k]])),
      );
    });

    it("keeps every schema field's default valid for that field", () => {
      expect(normalizeConfig(def.settingsSchema, schemaDefaults(def.settingsSchema))).toEqual(schemaDefaults(def.settingsSchema));
    });

    it("only scopes fields to sizes it actually has", () => {
      const sizeIds = new Set(def.sizes.map((s) => s.id));
      for (const field of Object.values(def.settingsSchema.properties)) {
        for (const id of field.appliesToSizes ?? []) expect(sizeIds.has(id)).toBe(true);
      }
    });

    it("describes itself", () => {
      expect(def.name.trim()).not.toBe("");
      expect(def.description.trim().length).toBeGreaterThan(20);
    });
  });

  it("looks widgets up and falls back to the default size", () => {
    const clock = getWidget("clock");
    expect(clock?.name).toBe("Clock");
    expect(getWidget("nope")).toBeUndefined();
    if (!clock) throw new Error("clock missing");
    expect(resolveSize(clock, "xl").id).toBe("xl");
    expect(resolveSize(clock, "s")).toBe(defaultSize(clock));
    expect(resolveSize(clock, undefined)).toBe(defaultSize(clock));
  });

  it("maps every kind of the first layout schema onto a real widget and size", () => {
    for (const [kind, target] of Object.entries(LEGACY_KINDS)) {
      const def = getWidget(target.widget);
      expect(def, kind).toBeDefined();
      expect(def?.sizes.some((s) => s.id === target.size), kind).toBe(true);
    }
    expect(Object.keys(LEGACY_KINDS).sort()).toEqual(
      ["battery-grid", "battery-ring", "calendar", "clock", "date-circle", "disk", "ram", "weather"].sort(),
    );
  });

  it("keeps the footprints the old kinds had", () => {
    const footprint = (kind: string): [number, number] => {
      const target = LEGACY_KINDS[kind];
      const size = target ? getWidget(target.widget)?.sizes.find((s) => s.id === target.size) : undefined;
      return [size?.w ?? 0, size?.h ?? 0];
    };
    expect(footprint("date-circle")).toEqual([2, 2]);
    expect(footprint("calendar")).toEqual([3, 2]);
    expect(footprint("battery-ring")).toEqual([2, 2]);
    expect(footprint("battery-grid")).toEqual([4, 2]);
    expect(footprint("ram")).toEqual([2, 2]);
    expect(footprint("disk")).toEqual([2, 2]);
    expect(footprint("weather")).toEqual([3, 1]);
  });

  it("repairs a damaged config instead of passing it on", () => {
    const clock = getWidget("clock");
    if (!clock) throw new Error("clock missing");
    const fixed = resolveConfig(clock, { matrixStyle: "neon", hour24: "yes", showSeconds: true, junk: 1 });
    expect(fixed.matrixStyle).toBe("blocks");
    expect(fixed.hour24).toBe(clock.defaultConfig.hour24);
    expect(fixed.showSeconds).toBe(true);
    expect("junk" in fixed).toBe(false);
  });
});

const SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    flag: { type: "boolean", title: "Flag", default: true },
    level: { type: "number", title: "Level", default: 20, minimum: 5, maximum: 50, multipleOf: 5 },
    ratio: { type: "number", title: "Ratio", default: 0.5, minimum: 0, maximum: 1, multipleOf: 0.1 },
    mode: { type: "string", title: "Mode", default: "a", oneOf: [{ const: "a", title: "A" }, { const: "b", title: "B" }] },
    name: { type: "string", title: "Name", default: "x", maxLength: 5 },
    tags: { type: "array", title: "Tags", default: [], maxItems: 3, uniqueItems: true, items: { type: "string", maxLength: 4 } },
    picks: {
      type: "array",
      title: "Picks",
      default: [],
      maxItems: 2,
      uniqueItems: true,
      items: { type: "string", oneOf: [{ const: "x", title: "X" }, { const: "y", title: "Y" }, { const: "z", title: "Z" }] },
    },
    only: { type: "boolean", title: "Only on l", default: false, appliesToSizes: ["l"] },
  },
};

describe("normalizeConfig", () => {
  it("returns the defaults for nothing, junk and non-objects", () => {
    const defaults = schemaDefaults(SCHEMA);
    expect(normalizeConfig(SCHEMA, undefined)).toEqual(defaults);
    expect(normalizeConfig(SCHEMA, null)).toEqual(defaults);
    expect(normalizeConfig(SCHEMA, "text")).toEqual(defaults);
    expect(normalizeConfig(SCHEMA, {})).toEqual(defaults);
  });

  it("keeps valid values and drops unknown keys", () => {
    const out = normalizeConfig(SCHEMA, { flag: false, mode: "b", extra: 1 });
    expect(out.flag).toBe(false);
    expect(out.mode).toBe("b");
    expect("extra" in out).toBe(false);
  });

  it("clamps numbers and snaps them to the step", () => {
    expect(normalizeConfig(SCHEMA, { level: 999 }).level).toBe(50);
    expect(normalizeConfig(SCHEMA, { level: -4 }).level).toBe(5);
    expect(normalizeConfig(SCHEMA, { level: 23 }).level).toBe(25);
    expect(normalizeConfig(SCHEMA, { level: Number.NaN }).level).toBe(20);
    expect(normalizeConfig(SCHEMA, { ratio: 0.3 }).ratio).toBe(0.3);
    expect(normalizeConfig(SCHEMA, { ratio: 0.34 }).ratio).toBe(0.3);
  });

  it("rejects values of the wrong type and options that do not exist", () => {
    expect(normalizeConfig(SCHEMA, { flag: "yes" }).flag).toBe(true);
    expect(normalizeConfig(SCHEMA, { mode: "c" }).mode).toBe("a");
    expect(normalizeConfig(SCHEMA, { level: "10" }).level).toBe(20);
  });

  it("truncates text and cleans lists", () => {
    expect(normalizeConfig(SCHEMA, { name: "abcdefgh" }).name).toBe("abcde");
    expect(normalizeConfig(SCHEMA, { tags: [" ab ", "ab", "", 3, "cdefg", "h", "i"] }).tags).toEqual(["ab", "cdef", "h"]);
    expect(normalizeConfig(SCHEMA, { tags: "ab" }).tags).toEqual([]);
  });

  it("limits list choices to the allowed ones, in order, without repeats", () => {
    expect(normalizeConfig(SCHEMA, { picks: ["z", "q", "x", "y", "z"] }).picks).toEqual(["z", "x"]);
  });
});

describe("fieldsForSize", () => {
  it("hides fields that do not apply to a size", () => {
    expect(fieldsForSize(SCHEMA, "m").map(([key]) => key)).not.toContain("only");
    expect(fieldsForSize(SCHEMA, "l").map(([key]) => key)).toContain("only");
  });
});

import { describe, expect, it } from "vitest";
import { BUILTIN_PROFILES, DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, LIMITS, defaultLayoutDoc } from "./defaults";
import { LAYOUT_MIGRATIONS, migrateDocument, SETTINGS_MIGRATIONS } from "./migrate";
import { sanitizeLayoutDoc, sanitizePlacements, sanitizeSettings } from "./sanitize";
import { LAYOUT_SCHEMA, SETTINGS_SCHEMA } from "./types";

describe("settings defaults", () => {
  it("are a fixed point of the sanitizer, so a fresh install reports no repairs", () => {
    const { value, repairs } = sanitizeSettings(DEFAULT_SETTINGS);
    expect(value).toEqual(DEFAULT_SETTINGS);
    expect(repairs).toEqual([]);
  });

  it("carry the current schema number", () => {
    expect(DEFAULT_SETTINGS.schema).toBe(SETTINGS_SCHEMA);
    expect(defaultLayoutDoc("work").schema).toBe(LAYOUT_SCHEMA);
  });

  it("ship the three named profiles", () => {
    expect(BUILTIN_PROFILES.map((p) => p.name)).toEqual(["Work", "Focus", "Minimal"]);
  });
});

describe("sanitizeSettings", () => {
  it("falls back to defaults for anything that is not an object", () => {
    for (const bad of [null, 5, "x", [], undefined]) {
      expect(sanitizeSettings(bad).value).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("repairs each bad field on its own and keeps the good ones", () => {
    const { value } = sanitizeSettings({
      theme: { mode: "schedule", fixedId: "paper", lightFrom: "25:99", darkFrom: "20:30" },
      layout: { collision: "swap", gap: 9999, edgeMargin: -5, guides: "yes" },
      appearance: { motion: "turbo", motionSpeed: 50, cornerRadius: 999, font: "mono" },
    });
    expect(value.theme).toMatchObject({ mode: "schedule", fixedId: "paper", lightFrom: "07:00", darkFrom: "20:30" });
    expect(value.layout).toMatchObject({ collision: "swap", gap: LIMITS.gap.max, edgeMargin: LIMITS.edgeMargin.min, guides: true });
    expect(value.appearance).toMatchObject({ motion: "system", motionSpeed: LIMITS.motionSpeed.max, cornerRadius: LIMITS.cornerRadius.max, font: "mono" });
  });

  it("clamps every numeric setting into its documented range", () => {
    const low = sanitizeSettings({ layout: { gap: 0, edgeMargin: 0 }, appearance: { motionSpeed: 0, cornerRadius: -10 } }).value;
    expect(low.layout.gap).toBe(LIMITS.gap.min);
    expect(low.layout.edgeMargin).toBe(LIMITS.edgeMargin.min);
    expect(low.appearance.motionSpeed).toBe(LIMITS.motionSpeed.min);
    expect(low.appearance.cornerRadius).toBe(LIMITS.cornerRadius.min);
  });

  it("rejects NaN and Infinity instead of storing them", () => {
    const value = sanitizeSettings({ layout: { gap: Number.NaN, edgeMargin: Infinity }, appearance: { motionSpeed: Number.NaN } }).value;
    expect(value.layout.gap).toBe(DEFAULT_SETTINGS.layout.gap);
    expect(value.layout.edgeMargin).toBe(DEFAULT_SETTINGS.layout.edgeMargin);
    expect(value.appearance.motionSpeed).toBe(1);
  });

  it("always keeps the built-in profiles and puts them first", () => {
    const { value, repairs } = sanitizeSettings({
      profiles: [{ id: "travel", name: "Travel" }, { id: "work", name: "Desk" }],
      activeProfileId: "travel",
    });
    expect(value.profiles.map((p) => p.id)).toEqual(["work", "focus", "minimal", "travel"]);
    expect(value.profiles.find((p) => p.id === "work")).toMatchObject({ name: "Desk", builtin: true });
    expect(value.profiles.find((p) => p.id === "travel")).toMatchObject({ builtin: false });
    expect(value.activeProfileId).toBe("travel");
    expect(repairs.some((r) => r.includes("built-in"))).toBe(true);
  });

  it("drops duplicate or malformed profiles and falls back when the active one is gone", () => {
    const { value } = sanitizeSettings({
      profiles: [{ id: "a b", name: "bad id" }, { id: "x", name: "X" }, { id: "x", name: "Again" }, 7],
      activeProfileId: "deleted",
    });
    expect(value.profiles.filter((p) => !p.builtin).map((p) => p.id)).toEqual(["x"]);
    expect(value.activeProfileId).toBe(value.profiles[0]?.id);
  });

  it("limits profile names and falls back to the id for blank ones", () => {
    const { value } = sanitizeSettings({ profiles: [{ id: "long", name: "n".repeat(100) }, { id: "blank", name: "   " }] });
    expect(value.profiles.find((p) => p.id === "long")?.name).toHaveLength(LIMITS.profileNameLength);
    expect(value.profiles.find((p) => p.id === "blank")?.name).toBe("blank");
  });

  it("normalises shortcut spelling and resets the ones that do not parse", () => {
    const { value } = sanitizeSettings({ shortcuts: { toggleEditMode: "ctrl+alt+e", openSettings: "banana", nextProfile: 3 } });
    expect(value.shortcuts.toggleEditMode).toBe("Ctrl+Alt+E");
    expect(value.shortcuts.openSettings).toBe(DEFAULT_SHORTCUTS.openSettings);
    expect(value.shortcuts.nextProfile).toBe(DEFAULT_SHORTCUTS.nextProfile);
  });

  it("keeps per-display margins within range and null when unset", () => {
    const { value } = sanitizeSettings({ displays: { left: { edgeMargin: 40 }, right: { edgeMargin: 5000 }, mid: {}, "": { edgeMargin: 4 } } });
    expect(value.displays["left"]?.edgeMargin).toBe(40);
    expect(value.displays["right"]?.edgeMargin).toBe(LIMITS.edgeMargin.max);
    expect(value.displays["mid"]?.edgeMargin).toBeNull();
    expect(value.displays[""]).toBeUndefined();
  });

  it("never lets a __proto__ key through", () => {
    const hostile = JSON.parse('{"displays":{"__proto__":{"edgeMargin":10}}}') as unknown;
    const { value } = sanitizeSettings(hostile);
    expect(Object.getPrototypeOf(value.displays)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)["edgeMargin"]).toBeUndefined();
  });
});

describe("sanitizePlacements", () => {
  it("coerces coordinates to non-negative position steps and strips non-JSON config values", () => {
    const [p] = sanitizePlacements([{ id: "c", widget: "clock", size: "m", x: 2.7, y: -4, config: { a: 1, bad: () => 1, nested: { ok: true } } }]);
    // Free placement keeps the fraction, rounded to the nearest 1/32 of a cell.
    expect(p).toMatchObject({ x: 86 / 32, y: 0 });
    expect(p?.config).toEqual({ a: 1, nested: { ok: true } });
  });

  it("drops entries without a widget id and renames duplicate ids", () => {
    const result = sanitizePlacements([
      { id: "a", widget: "clock" },
      { id: "a", widget: "clock" },
      { id: "b" },
      "nonsense",
    ]);
    expect(result.map((p) => p.id)).toEqual(["a", "a-2"]);
  });

  it("keeps widgets this build does not know so they survive an app downgrade", () => {
    expect(sanitizePlacements([{ id: "z", widget: "from-the-future", size: "q", x: 1, y: 1 }])).toHaveLength(1);
  });

  it("caps the number of widgets", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `w${i}`, widget: "clock" }));
    expect(sanitizePlacements(many)).toHaveLength(64);
  });
});

describe("layout documents", () => {
  it("round-trip through the sanitizer unchanged", () => {
    const doc = defaultLayoutDoc("work");
    expect(sanitizeLayoutDoc(doc, "work").value).toEqual(doc);
  });

  it("forces the profile id from where the document was stored", () => {
    expect(sanitizeLayoutDoc({ profileId: "evil", monitors: {} }, "focus").value.profileId).toBe("focus");
  });

  it("keeps each monitor's placements separate", () => {
    const { value } = sanitizeLayoutDoc(
      { monitors: { left: { placements: [{ id: "a", widget: "clock" }] }, right: { placements: [{ id: "b", widget: "system" }] } } },
      "work",
    );
    expect(value.monitors["left"]?.placements[0]?.id).toBe("a");
    expect(value.monitors["right"]?.placements[0]?.id).toBe("b");
  });
});

describe("migrations", () => {
  const v1 = {
    schema: 1,
    placements: [
      { id: "clock-1", kind: "clock", x: 0, y: 0, config: { matrixStyle: "blocks", hour24: true, showSeconds: false, blinkColon: false, height: 128 } },
      { id: "battery-ring-1", kind: "battery-ring", x: 0, y: 2 },
      { id: "clock-2", kind: "clock", x: 0, y: 5, config: { matrixStyle: "dots", hour24: false, showSeconds: true, blinkColon: true, height: 40 } },
      { id: "clock-3", kind: "clock", x: 4, y: 5, config: { matrixStyle: "dots", hour24: false, showSeconds: true, blinkColon: true, height: 240 } },
    ],
  };

  it("upgrades a v1 layout to the registry model on the primary monitor", () => {
    const result = migrateDocument(v1, LAYOUT_SCHEMA, LAYOUT_MIGRATIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.from).toBe(1);
    expect(result.doc["schema"]).toBe(3);
    const { value } = sanitizeLayoutDoc(result.doc, "work");
    const placements = value.monitors["primary"]?.placements ?? [];
    expect(placements.map((p) => [p.id, p.widget, p.size])).toEqual([
      ["clock-1", "clock", "m"],
      ["battery-ring-1", "battery", "m"],
      ["clock-2", "clock", "m"],
      ["clock-3", "clock", "xl"],
    ]);
    // The old clock's private pixel height is gone; options the new clock still has are kept.
    expect(placements[0]?.config).toEqual({ matrixStyle: "blocks", hour24: true, showSeconds: false, blinkColon: false });
    expect(placements[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("maps every kind of the first overlay onto a registry widget, keeping unknown kinds", () => {
    const doc = {
      schema: 2,
      monitors: {
        primary: {
          placements: [
            { id: "d", kind: "date-circle", size: "m", x: 0, y: 0, config: {} },
            { id: "r", kind: "ram", size: "m", x: 2, y: 0, config: { stale: true } },
            { id: "k", kind: "disk", size: "m", x: 4, y: 0, config: {} },
            { id: "g", kind: "battery-grid", size: "m", x: 6, y: 0, config: {} },
            { id: "f", kind: "from-the-future", size: "q", x: 8, y: 0, config: {} },
          ],
        },
      },
    };
    const result = migrateDocument(doc, LAYOUT_SCHEMA, LAYOUT_MIGRATIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const placements = sanitizeLayoutDoc(result.doc, "work").value.monitors["primary"]?.placements ?? [];
    expect(placements.map((p) => [p.widget, p.size])).toEqual([
      ["date", "s"],
      ["system", "m"],
      ["system", "m"],
      ["battery", "l"],
      ["from-the-future", "q"],
    ]);
    expect(placements[1]?.config).toEqual({ metric: "ram" });
    expect(placements[2]?.config).toEqual({ metric: "disk" });
  });

  it("does not modify the document it was given", () => {
    const before = JSON.stringify(v1);
    migrateDocument(v1, LAYOUT_SCHEMA, LAYOUT_MIGRATIONS);
    expect(JSON.stringify(v1)).toBe(before);
  });

  it("tolerates a v1 file with a missing or malformed placement list", () => {
    for (const doc of [{ schema: 1 }, { schema: 1, placements: "nope" }, { schema: 1, placements: [null, 4] }]) {
      const result = migrateDocument(doc, LAYOUT_SCHEMA, LAYOUT_MIGRATIONS);
      expect(result.ok).toBe(true);
      if (result.ok) expect(sanitizeLayoutDoc(result.doc, "work").value.monitors["primary"]?.placements).toEqual([]);
    }
  });

  it("passes a current-schema document through untouched", () => {
    const doc = { schema: 3, monitors: {} };
    const result = migrateDocument(doc, LAYOUT_SCHEMA, LAYOUT_MIGRATIONS);
    expect(result).toEqual({ ok: true, doc, from: 3 });
  });

  it("refuses documents from a newer app instead of downgrading them", () => {
    expect(migrateDocument({ schema: 99 }, LAYOUT_SCHEMA, LAYOUT_MIGRATIONS)).toEqual({ ok: false, reason: "future", from: 99 });
  });

  it("rejects documents with no usable schema number", () => {
    expect(migrateDocument({ placements: [] }, LAYOUT_SCHEMA, LAYOUT_MIGRATIONS)).toMatchObject({ ok: false, reason: "no-schema" });
    expect(migrateDocument({ schema: "1" }, LAYOUT_SCHEMA, LAYOUT_MIGRATIONS)).toMatchObject({ ok: false, reason: "no-schema" });
    expect(migrateDocument({ schema: 0 }, LAYOUT_SCHEMA, LAYOUT_MIGRATIONS)).toMatchObject({ ok: false, reason: "no-schema" });
    expect(migrateDocument([], LAYOUT_SCHEMA, LAYOUT_MIGRATIONS)).toMatchObject({ ok: false, reason: "not-an-object" });
  });

  it("reports a gap when a step is missing from the chain", () => {
    expect(migrateDocument({ schema: 1 }, 3, { 2: (d) => d })).toMatchObject({ ok: false, reason: "gap" });
  });

  it("chains several steps in order", () => {
    const steps = { 1: (d: Record<string, unknown>) => ({ ...d, trail: "a" }), 2: (d: Record<string, unknown>) => ({ ...d, trail: `${String(d["trail"])}b` }) };
    const result = migrateDocument({ schema: 1 }, 3, steps);
    expect(result).toMatchObject({ ok: true, doc: { schema: 3, trail: "ab" } });
  });

  it("has no settings migrations yet, because settings schema 1 is the first", () => {
    expect(Object.keys(SETTINGS_MIGRATIONS)).toEqual([]);
  });
});

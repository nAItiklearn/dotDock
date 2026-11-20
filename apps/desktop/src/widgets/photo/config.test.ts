import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fieldsForSize, normalizeConfig, schemaDefaults, type ConfigValue } from "../configSchema";
import { sizesByArea } from "../sizes";
import { DEFAULT_PHOTO_CONFIG, PHOTO_SCHEMA, PHOTO_SIZES, RADIUS, THICKNESS } from "./config";
import { MAX_CAPTION_LENGTH } from "./look";

const tokens = readFileSync(new URL("../../design-system/tokens.css", import.meta.url), "utf8");
const token = (name: string): string => new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim() ?? "";

const resolve = (raw: unknown): Record<string, ConfigValue> => normalizeConfig(PHOTO_SCHEMA, raw);
const shown = (config: Record<string, ConfigValue>): string[] => fieldsForSize(PHOTO_SCHEMA, "l", config).map(([key]) => key);

describe("saved settings from before the border options", () => {
  it("an old edge-to-edge photo keeps its look: same fit, tone, corners, shadow", () => {
    const old = { fit: "fit", mat: "none", tone: "mono" };
    expect(resolve(old)).toEqual({ ...DEFAULT_PHOTO_CONFIG, fit: "fit", tone: "mono" });
  });

  it("an old mat becomes the Mat border at the width and colour it always had", () => {
    const config = resolve({ fit: "fill", mat: "mat", tone: "colour" });
    expect(config).toMatchObject({ frame: "mat", thickness: 12, tint: "paper", radius: 28, shape: "rounded", shadow: true });
  });

  it("an empty or unreadable setting falls back to the default look", () => {
    expect(resolve({})).toEqual(DEFAULT_PHOTO_CONFIG);
    expect(resolve(null)).toEqual(DEFAULT_PHOTO_CONFIG);
    expect(resolve("mat")).toEqual(DEFAULT_PHOTO_CONFIG);
  });

  it("prefers the new border setting over a leftover old one", () => {
    expect(resolve({ mat: "mat", frame: "polaroid" })["frame"]).toBe("polaroid");
  });

  it("ignores an old value the new setting does not know", () => {
    expect(resolve({ mat: "frame" })["frame"]).toBe("none");
  });

  it("the defaults are the pre-border values: --radius-lg corners and a --space-3 mat", () => {
    expect(`${RADIUS.initial}px`).toBe(token("--radius-lg"));
    expect(`${THICKNESS.initial}px`).toBe(token("--space-3"));
    expect(DEFAULT_PHOTO_CONFIG).toMatchObject({ frame: "none", shape: "rounded", tint: "paper", shadow: true });
  });
});

describe("saved settings today", () => {
  it("round-trips every option unchanged", () => {
    const full = {
      fit: "fit",
      frame: "polaroid",
      shape: "squircle",
      radius: 16,
      thickness: 20,
      tint: "accent",
      caption: "Kyoto, May",
      shadow: false,
      tone: "duotone",
    };
    const once = resolve(full);
    expect(once).toEqual(full);
    expect(resolve(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it("repairs hand-edited values: unknown choices, out-of-range and off-grid numbers, long captions", () => {
    const repaired = resolve({
      frame: "ornate",
      shape: "star",
      tint: "neon",
      radius: 999,
      thickness: 13,
      caption: "x".repeat(MAX_CAPTION_LENGTH + 20),
      shadow: "yes",
    });
    expect(repaired).toMatchObject({ frame: "none", shape: "rounded", tint: "paper", radius: RADIUS.max, shadow: true });
    expect(repaired["thickness"]).toBe(12);
    expect((repaired["caption"] as string).length).toBe(MAX_CAPTION_LENGTH);
  });

  it("drops keys it does not own", () => {
    expect(Object.keys(resolve({ nonsense: 1, frame: "mat" })).sort()).toEqual(Object.keys(DEFAULT_PHOTO_CONFIG).sort());
  });

  it("keeps the schema defaults equal to the default config", () => {
    expect(schemaDefaults(PHOTO_SCHEMA)).toEqual(DEFAULT_PHOTO_CONFIG);
  });
});

describe("what the settings panel shows", () => {
  it("shows only fit, border, shape, corners, shadow and colour for an edge-to-edge photo", () => {
    expect(shown(resolve({}))).toEqual(["fit", "frame", "shape", "radius", "shadow", "tone"]);
  });

  it("adds width and colour for a banded border, and a caption for a polaroid", () => {
    expect(shown(resolve({ frame: "mat" }))).toEqual(["fit", "frame", "thickness", "tint", "shape", "radius", "shadow", "tone"]);
    const polaroid = shown(resolve({ frame: "polaroid" }));
    expect(polaroid).toContain("caption");
    expect(polaroid).not.toContain("shape");
    expect(polaroid).toContain("radius");
  });

  it("hides the corner radius for a circle", () => {
    expect(shown(resolve({ shape: "circle" }))).not.toContain("radius");
  });
});

describe("sizes", () => {
  it("keeps the footprints that saved layouts already hold", () => {
    const byId = Object.fromEntries(PHOTO_SIZES.map((s) => [s.id, `${s.w}x${s.h}`]));
    expect(byId).toMatchObject({ l: "4x4", s: "2x2", m: "4x2", xl: "3x4" });
  });

  it("starts with Large so a new photo starts big", () => {
    expect(PHOTO_SIZES[0]).toMatchObject({ id: "l", w: 4, h: 4 });
  });

  it("offers a small, medium and large square plus wide, landscape, tall, portrait and panorama", () => {
    expect(PHOTO_SIZES.map((s) => s.name)).toEqual(["Large", "Medium", "Small", "Wide", "Landscape", "Tall", "Portrait", "Panorama"]);
  });

  it("never repeats a footprint, so a resize always lands on exactly one preset", () => {
    const shapes = PHOTO_SIZES.map((s) => `${s.w}x${s.h}`);
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it("lists smallest first for pickers without losing any", () => {
    const ordered = sizesByArea(PHOTO_SIZES);
    expect(ordered).toHaveLength(PHOTO_SIZES.length);
    expect(ordered[0]?.id).toBe("s");
    expect(ordered.at(-1)?.id).toBe("l");
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1];
      const next = ordered[i];
      expect((next?.w ?? 0) * (next?.h ?? 0)).toBeGreaterThanOrEqual((prev?.w ?? 0) * (prev?.h ?? 0));
    }
  });
});

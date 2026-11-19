import { isRecord } from "./json";

/** Upgrades a document from schema N to N + 1. Must be pure and must not assume the input is clean. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

export type MigrationOutcome =
  | { readonly ok: true; readonly doc: Record<string, unknown>; readonly from: number }
  | { readonly ok: false; readonly reason: "not-an-object" | "no-schema" | "future" | "gap"; readonly from?: number };

/**
 * Runs every migration from the document's own schema up to `current`.
 * A document written by a newer app ("future") is refused rather than downgraded.
 */
export function migrateDocument(
  raw: unknown,
  current: number,
  steps: Readonly<Record<number, Migration>>,
): MigrationOutcome {
  if (!isRecord(raw)) return { ok: false, reason: "not-an-object" };
  const from = raw["schema"];
  if (typeof from !== "number" || !Number.isInteger(from) || from < 1) return { ok: false, reason: "no-schema" };
  if (from > current) return { ok: false, reason: "future", from };
  let doc: Record<string, unknown> = raw;
  for (let version = from; version < current; version++) {
    const step = steps[version];
    if (!step) return { ok: false, reason: "gap", from };
    doc = { ...step(doc), schema: version + 1 };
  }
  return { ok: true, doc, from };
}

// ------------------------------------------------------------------ layout

/** Digit height (px) of the v1 clock mapped to the size ids introduced in v2. */
const V1_CLOCK_SMALL_MAX = 64;
const V1_CLOCK_LARGE_MIN = 176;

function v1ClockSize(config: unknown): string {
  const height = isRecord(config) ? config["height"] : undefined;
  if (typeof height !== "number") return "m";
  if (height <= V1_CLOCK_SMALL_MAX) return "s";
  return height >= V1_CLOCK_LARGE_MIN ? "l" : "m";
}

function layoutV1Placement(entry: unknown): unknown {
  if (!isRecord(entry)) return entry;
  const config = isRecord(entry["config"]) ? { ...entry["config"] } : {};
  const size = entry["kind"] === "clock" ? v1ClockSize(config) : "m";
  delete config["height"];
  return { ...entry, size, config };
}

/**
 * v1 was a single flat list of placements. v2 keys placements by monitor so each display keeps
 * its own arrangement; the old list becomes the primary display's layout.
 */
function layoutV1ToV2(doc: Record<string, unknown>): Record<string, unknown> {
  const placements = Array.isArray(doc["placements"]) ? doc["placements"].map(layoutV1Placement) : [];
  return { monitors: { primary: { placements } } };
}

export const LAYOUT_MIGRATIONS: Readonly<Record<number, Migration>> = { 1: layoutV1ToV2 };

/** Settings have never changed shape yet; the table exists so the first change is a one-line addition. */
export const SETTINGS_MIGRATIONS: Readonly<Record<number, Migration>> = {};

export const THEME_MIGRATIONS: Readonly<Record<number, Migration>> = {};

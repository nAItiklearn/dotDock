import { BUILTIN_PROFILES, DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, LIMITS, SHORTCUT_ACTIONS } from "./defaults";
import {
  boolOr,
  intInRange,
  isRecord,
  isSafeKey,
  numberInRange,
  oneOf,
  Repairs,
  textOr,
  toJsonObject,
} from "./json";
import { normalizeShortcut } from "../shortcuts";
import {
  LAYOUT_SCHEMA,
  SETTINGS_SCHEMA,
  type AppSettings,
  type DisplayOverride,
  type LayoutDoc,
  type MonitorId,
  type MonitorLayout,
  type Placement,
  type ProfileMeta,
  type ShortcutAction,
  type ThemeSelection,
} from "./types";

export interface Sanitized<T> {
  readonly value: T;
  readonly repairs: readonly string[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_PLACEMENTS = 64;
const MAX_DISPLAYS = 16;
const MAX_COORDINATE = 4096;

export function isValidId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function idOr(value: unknown, fallback: string): string {
  return isValidId(value) ? value : fallback;
}

function timeOr(value: unknown, fallback: string): string {
  return typeof value === "string" && TIME_PATTERN.test(value) ? value : fallback;
}

function sanitizeThemeSelection(raw: unknown, r: Repairs): ThemeSelection {
  const d = DEFAULT_SETTINGS.theme;
  if (!isRecord(raw)) {
    if (raw !== undefined) r.note("theme", "not an object");
    return d;
  }
  return {
    mode: oneOf(raw["mode"], ["fixed", "system", "schedule"], d.mode),
    fixedId: idOr(raw["fixedId"], d.fixedId),
    lightId: idOr(raw["lightId"], d.lightId),
    darkId: idOr(raw["darkId"], d.darkId),
    lightFrom: timeOr(raw["lightFrom"], d.lightFrom),
    darkFrom: timeOr(raw["darkFrom"], d.darkFrom),
  };
}

function sanitizeProfiles(raw: unknown, r: Repairs): readonly ProfileMeta[] {
  const seen = new Set<string>();
  const profiles: ProfileMeta[] = [];
  const builtinIds = new Set(BUILTIN_PROFILES.map((b) => b.id));
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!isRecord(entry) || !isValidId(entry["id"]) || seen.has(entry["id"])) {
        r.note("profiles", "dropped an invalid or duplicate profile");
        continue;
      }
      const id = entry["id"];
      const builtin = builtinIds.has(id);
      const fallbackName = BUILTIN_PROFILES.find((b) => b.id === id)?.name ?? id;
      seen.add(id);
      profiles.push({ id, name: textOr(entry["name"], LIMITS.profileNameLength, fallbackName), builtin });
    }
  }
  // Built-in profiles always exist, in their canonical order ahead of user profiles.
  if (Array.isArray(raw) && BUILTIN_PROFILES.some((b) => !seen.has(b.id))) {
    r.note("profiles", "restored missing built-in profiles");
  }
  const stored = new Map(profiles.map((p) => [p.id, p] as const));
  const builtins = BUILTIN_PROFILES.map((b) => stored.get(b.id) ?? b);
  return [...builtins, ...profiles.filter((p) => !p.builtin)].slice(0, LIMITS.maxProfiles + BUILTIN_PROFILES.length);
}

function sanitizeDisplays(raw: unknown, r: Repairs): Readonly<Record<MonitorId, DisplayOverride>> {
  if (!isRecord(raw)) return {};
  const out: Record<MonitorId, DisplayOverride> = {};
  for (const [id, entry] of Object.entries(raw).slice(0, MAX_DISPLAYS)) {
    if (id.length === 0 || id.length > 200 || !isSafeKey(id) || !isRecord(entry)) {
      r.note("displays", "dropped an invalid entry");
      continue;
    }
    const margin = entry["edgeMargin"];
    out[id] = {
      edgeMargin:
        typeof margin === "number" && Number.isFinite(margin)
          ? intInRange(margin, LIMITS.edgeMargin.min, LIMITS.edgeMargin.max, DEFAULT_SETTINGS.layout.edgeMargin)
          : null,
    };
  }
  return out;
}

function sanitizeShortcuts(raw: unknown, r: Repairs): Readonly<Record<ShortcutAction, string>> {
  const source = isRecord(raw) ? raw : {};
  const out = { ...DEFAULT_SHORTCUTS };
  for (const action of SHORTCUT_ACTIONS) {
    const value = source[action];
    if (value === undefined) continue;
    const normalized = typeof value === "string" ? normalizeShortcut(value) : null;
    if (normalized) out[action] = normalized;
    else r.note(`shortcuts.${action}`, "not a valid shortcut, reset to default");
  }
  return out;
}

/** Tolerant reader: every field is repaired on its own, so one bad value never costs the whole file. */
export function sanitizeSettings(raw: unknown): Sanitized<AppSettings> {
  const r = new Repairs();
  const s = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) r.note("settings", "not an object, using defaults");
  const d = DEFAULT_SETTINGS;
  const appearance = isRecord(s["appearance"]) ? s["appearance"] : {};
  const layout = isRecord(s["layout"]) ? s["layout"] : {};

  const profiles = sanitizeProfiles(s["profiles"], r);
  const requestedActive = s["activeProfileId"];
  const activeProfileId =
    typeof requestedActive === "string" && profiles.some((p) => p.id === requestedActive)
      ? requestedActive
      : (profiles[0]?.id ?? d.activeProfileId);
  if (requestedActive !== undefined && activeProfileId !== requestedActive) {
    r.note("activeProfileId", "profile no longer exists, switched to the first one");
  }

  const radius = appearance["cornerRadius"];
  const value: AppSettings = {
    schema: SETTINGS_SCHEMA,
    activeProfileId,
    profiles,
    theme: sanitizeThemeSelection(s["theme"], r),
    appearance: {
      cornerRadius:
        typeof radius === "number" && Number.isFinite(radius)
          ? intInRange(radius, LIMITS.cornerRadius.min, LIMITS.cornerRadius.max, LIMITS.cornerRadius.max)
          : null,
      font: oneOf(appearance["font"], ["sans", "mono"], d.appearance.font),
      motion: oneOf(appearance["motion"], ["system", "full", "reduced"], d.appearance.motion),
      motionSpeed: numberInRange(
        appearance["motionSpeed"],
        LIMITS.motionSpeed.min,
        LIMITS.motionSpeed.max,
        d.appearance.motionSpeed,
      ),
    },
    layout: {
      collision: oneOf(layout["collision"], ["push", "swap"], d.layout.collision),
      guides: boolOr(layout["guides"], d.layout.guides),
      locked: boolOr(layout["locked"], d.layout.locked),
      gap: intInRange(layout["gap"], LIMITS.gap.min, LIMITS.gap.max, d.layout.gap),
      edgeMargin: intInRange(layout["edgeMargin"], LIMITS.edgeMargin.min, LIMITS.edgeMargin.max, d.layout.edgeMargin),
    },
    displays: sanitizeDisplays(s["displays"], r),
    shortcuts: sanitizeShortcuts(s["shortcuts"], r),
  };
  return { value, repairs: r.notes };
}

// ---------------------------------------------------------------- layout

function sanitizePlacement(raw: unknown, r: Repairs): Placement | null {
  if (!isRecord(raw)) {
    r.note("placement", "not an object");
    return null;
  }
  const widget = typeof raw["widget"] === "string" ? raw["widget"].trim().slice(0, 64) : "";
  if (widget === "") {
    r.note("placement", "missing widget id");
    return null;
  }
  return {
    id: textOr(raw["id"], 64, widget),
    widget,
    size: textOr(raw["size"], 32, "m"),
    x: intInRange(raw["x"], 0, MAX_COORDINATE, 0),
    y: intInRange(raw["y"], 0, MAX_COORDINATE, 0),
    config: toJsonObject(raw["config"]),
  };
}

/** Unique ids matter: they are React keys and the target of every edit. */
function dedupeIds(placements: readonly Placement[], r: Repairs): Placement[] {
  const used = new Set<string>();
  return placements.map((pl) => {
    if (!used.has(pl.id)) {
      used.add(pl.id);
      return pl;
    }
    let n = 2;
    while (used.has(`${pl.id}-${n}`)) n++;
    const id = `${pl.id}-${n}`;
    used.add(id);
    r.note("placement", `duplicate id "${pl.id}" renamed`);
    return { ...pl, id };
  });
}

export function sanitizePlacements(raw: unknown, r: Repairs = new Repairs()): Placement[] {
  if (!Array.isArray(raw)) return [];
  const placements = raw
    .slice(0, MAX_PLACEMENTS)
    .map((entry) => sanitizePlacement(entry, r))
    .filter((pl): pl is Placement => pl !== null);
  return dedupeIds(placements, r);
}

export function sanitizeLayoutDoc(raw: unknown, profileId: string): Sanitized<LayoutDoc> {
  const r = new Repairs();
  const source = isRecord(raw) ? raw : {};
  const monitors: Record<MonitorId, MonitorLayout> = {};
  const rawMonitors = isRecord(source["monitors"]) ? source["monitors"] : {};
  for (const [id, entry] of Object.entries(rawMonitors).slice(0, MAX_DISPLAYS)) {
    if (id.length === 0 || id.length > 200 || !isSafeKey(id) || !isRecord(entry)) {
      r.note("monitors", "dropped an invalid entry");
      continue;
    }
    monitors[id] = { placements: sanitizePlacements(entry["placements"], r) };
  }
  return { value: { schema: LAYOUT_SCHEMA, profileId, monitors }, repairs: r.notes };
}

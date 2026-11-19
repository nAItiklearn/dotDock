import type { Theme, ThemeColors } from "../../design-system/themes";
import { LIMITS } from "../model/defaults";
import { isRecord, numberInRange, textOr } from "../model/json";
import { migrateDocument, THEME_MIGRATIONS } from "../model/migrate";
import { THEME_SCHEMA } from "../model/types";
import { formatColor, parseColor, toCss } from "./color";

export const THEME_ROLES = [
  "bg",
  "surface",
  "surface2",
  "border",
  "text",
  "textDim",
  "accent",
  "accentInk",
  "dotOn",
  "dotOff",
  "danger",
  "success",
] as const;
export type ThemeRole = (typeof THEME_ROLES)[number];

export const THEME_FILE_KIND = "dotdock-theme";
/** A theme file is a handful of colours; anything bigger is not one. */
export const MAX_THEME_FILE_BYTES = 64 * 1024;
export const DEFAULT_SHADOW_STRENGTH = 0.4;

export interface ThemeDoc {
  readonly kind: typeof THEME_FILE_KIND;
  readonly schema: typeof THEME_SCHEMA;
  readonly id: string;
  readonly name: string;
  readonly mode: "light" | "dark";
  /** Canonical #rrggbb or #rrggbbaa. */
  readonly colors: Readonly<Record<ThemeRole, string>>;
  /** 0..1, drives the soft shadow under cards. */
  readonly shadowStrength: number;
}

export type ThemeParseResult =
  | { readonly ok: true; readonly theme: ThemeDoc }
  | { readonly ok: false; readonly errors: readonly string[] };

const BUILTIN_IDS = new Set(["obsidian", "paper", "aurum"]);

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug.length > 0 ? slug : "theme";
}

/** An id that collides with neither a built-in theme nor an existing custom one. */
export function uniqueThemeId(name: string, taken: ReadonlySet<string>): string {
  const base = `custom-${slugify(name)}`;
  let candidate = base;
  for (let n = 2; taken.has(candidate) || BUILTIN_IDS.has(candidate); n++) candidate = `${base}-${n}`;
  return candidate;
}

/** Validates every field and says what is wrong, in words a person can act on. */
export function validateThemeDoc(raw: unknown): ThemeParseResult {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["The file is not a theme object."] };
  if (raw["kind"] !== undefined && raw["kind"] !== THEME_FILE_KIND) {
    errors.push(`"kind" must be "${THEME_FILE_KIND}".`);
  }
  const migrated = migrateDocument(raw["schema"] === undefined ? { ...raw, schema: THEME_SCHEMA } : raw, THEME_SCHEMA, THEME_MIGRATIONS);
  if (!migrated.ok) {
    errors.push(
      migrated.reason === "future"
        ? "This theme was made with a newer version of the app."
        : 'The theme has no valid "schema" number.',
    );
    return { ok: false, errors };
  }
  const doc = migrated.doc;
  const mode = doc["mode"];
  if (mode !== "light" && mode !== "dark") errors.push('"mode" must be "light" or "dark".');
  const name = textOr(doc["name"], LIMITS.themeNameLength, "");
  if (name === "") errors.push('"name" is required.');

  const colors: Partial<Record<ThemeRole, string>> = {};
  const rawColors = doc["colors"];
  if (!isRecord(rawColors)) {
    errors.push('"colors" must be an object.');
  } else {
    for (const role of THEME_ROLES) {
      const value = rawColors[role];
      const parsed = typeof value === "string" ? parseColor(value) : null;
      if (parsed) colors[role] = formatColor(parsed);
      else errors.push(`colors.${role} must be a colour such as #e94248 or rgba(233, 66, 72, 0.8).`);
    }
  }
  if (errors.length > 0 || (mode !== "light" && mode !== "dark")) return { ok: false, errors };
  const id = typeof doc["id"] === "string" && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(doc["id"]) ? doc["id"] : `custom-${slugify(name)}`;
  return {
    ok: true,
    theme: {
      kind: THEME_FILE_KIND,
      schema: THEME_SCHEMA,
      id,
      name,
      mode,
      colors: colors as Record<ThemeRole, string>,
      shadowStrength: numberInRange(doc["shadowStrength"], 0, 1, DEFAULT_SHADOW_STRENGTH),
    },
  };
}

export function parseThemeFile(text: string): ThemeParseResult {
  if (text.length > MAX_THEME_FILE_BYTES) return { ok: false, errors: ["The file is too large to be a theme."] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["The file is not valid JSON."] };
  }
  return validateThemeDoc(raw);
}

export function serializeTheme(theme: ThemeDoc): string {
  return `${JSON.stringify(theme, null, 2)}\n`;
}

/** Filename for an exported theme, safe on every filesystem. */
export function themeFileName(theme: ThemeDoc): string {
  return `${slugify(theme.name)}.theme.json`;
}

const SHADOW_GEOMETRY = {
  dark: { offset: 12, blur: 32, maxAlpha: 0.9, tint: "0, 0, 0" },
  light: { offset: 10, blur: 28, maxAlpha: 0.3, tint: "17, 17, 17" },
} as const;

export function shadowFor(mode: "light" | "dark", strength: number): string {
  const g = SHADOW_GEOMETRY[mode];
  const alpha = Math.round(strength * g.maxAlpha * 100) / 100;
  return `0 ${g.offset}px ${g.blur}px rgba(${g.tint}, ${alpha})`;
}

/** The runtime shape the design system's applyTheme understands. */
export function toRuntimeTheme(doc: ThemeDoc): Theme {
  const css = (role: ThemeRole): string => {
    const parsed = parseColor(doc.colors[role]);
    return parsed ? toCss(parsed) : doc.colors[role];
  };
  const colors: ThemeColors = {
    bg: css("bg"),
    surface: css("surface"),
    surface2: css("surface2"),
    border: css("border"),
    text: css("text"),
    textDim: css("textDim"),
    accent: css("accent"),
    accentInk: css("accentInk"),
    dotOn: css("dotOn"),
    dotOff: css("dotOff"),
    danger: css("danger"),
    success: css("success"),
    shadow: shadowFor(doc.mode, doc.shadowStrength),
  };
  return { id: doc.id, name: doc.name, mode: doc.mode, colors };
}

/** Starting point for "Duplicate and edit" from any theme, built-in or custom. */
export function themeToDoc(theme: Theme, id: string, name: string): ThemeDoc {
  const canonical = (value: string): string => {
    const parsed = parseColor(value);
    return parsed ? formatColor(parsed) : value;
  };
  const colors = Object.fromEntries(THEME_ROLES.map((role) => [role, canonical(theme.colors[role])])) as Record<ThemeRole, string>;
  return { kind: THEME_FILE_KIND, schema: THEME_SCHEMA, id, name, mode: theme.mode, colors, shadowStrength: DEFAULT_SHADOW_STRENGTH };
}

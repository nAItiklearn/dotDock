import type { DocumentCodec } from "../storage/documentStore";
import { validateThemeDoc, type ThemeDoc } from "../theme/schema";
import { DEFAULT_SETTINGS, defaultLayoutDoc } from "./defaults";
import { LAYOUT_MIGRATIONS, SETTINGS_MIGRATIONS, THEME_MIGRATIONS } from "./migrate";
import { sanitizeLayoutDoc, sanitizeSettings } from "./sanitize";
import { LAYOUT_SCHEMA, SETTINGS_SCHEMA, THEME_SCHEMA, type AppSettings, type LayoutDoc } from "./types";

export const settingsCodec: DocumentCodec<AppSettings> = {
  schema: SETTINGS_SCHEMA,
  migrations: SETTINGS_MIGRATIONS,
  defaults: () => DEFAULT_SETTINGS,
  decode: (doc) => sanitizeSettings(doc),
};

export function layoutCodec(profileId: string): DocumentCodec<LayoutDoc> {
  return {
    schema: LAYOUT_SCHEMA,
    migrations: LAYOUT_MIGRATIONS,
    defaults: () => defaultLayoutDoc(profileId),
    decode: (doc) => sanitizeLayoutDoc(doc, profileId),
  };
}

/** A theme that fails validation is treated as damaged, so the document layer falls back to its backup. */
export function themeCodec(fallback: ThemeDoc): DocumentCodec<ThemeDoc> {
  return {
    schema: THEME_SCHEMA,
    migrations: THEME_MIGRATIONS,
    defaults: () => fallback,
    decode: (doc) => {
      const result = validateThemeDoc(doc);
      if (!result.ok) throw new Error(result.errors.join(" "));
      return { value: result.theme, repairs: [] };
    },
  };
}

export const SETTINGS_NAME = "settings";
export const layoutName = (profileId: string): string => `layouts/${profileId}`;
export const themeName = (themeId: string): string => `themes/${themeId}`;

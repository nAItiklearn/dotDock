import { validateThemeDoc, type ThemeDoc } from "../theme/schema";
import { isRecord } from "./json";
import { LAYOUT_MIGRATIONS, migrateDocument } from "./migrate";
import { isValidId, sanitizeLayoutDoc, sanitizeSettings } from "./sanitize";
import { BACKUP_SCHEMA, LAYOUT_SCHEMA, type AppSettings, type LayoutDoc } from "./types";

export const BACKUP_FILE_KIND = "dotdock-backup";
/** Everything a person can plausibly have fits in far less; this stops a wrong file from being read at all. */
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;

export interface BackupBundle {
  readonly kind: typeof BACKUP_FILE_KIND;
  readonly schema: typeof BACKUP_SCHEMA;
  readonly createdAt: string;
  readonly app: { readonly name: string; readonly version: string };
  readonly settings: AppSettings;
  /** Keyed by profile id. */
  readonly layouts: Readonly<Record<string, LayoutDoc>>;
  readonly themes: readonly ThemeDoc[];
}

export type BackupParseResult =
  | { readonly ok: true; readonly bundle: BackupBundle; readonly skipped: readonly string[] }
  | { readonly ok: false; readonly errors: readonly string[] };

export function serializeBackup(bundle: BackupBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

/**
 * Reads a backup file. Each part goes through the same migration and sanitising as live data, so a
 * backup from an older version imports cleanly and one with a damaged part still imports the rest.
 */
export function parseBackup(text: string): BackupParseResult {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, errors: ["The file is too large to be a backup."] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["The file is not valid JSON."] };
  }
  if (!isRecord(raw) || raw["kind"] !== BACKUP_FILE_KIND) {
    return { ok: false, errors: ["This is not a backup made by the app."] };
  }
  if (typeof raw["schema"] !== "number" || raw["schema"] > BACKUP_SCHEMA) {
    return { ok: false, errors: ["This backup was made by a newer version of the app."] };
  }
  const skipped: string[] = [];

  const settings = sanitizeSettings(raw["settings"]).value;

  const layouts: Record<string, LayoutDoc> = {};
  const rawLayouts = isRecord(raw["layouts"]) ? raw["layouts"] : {};
  for (const [profileId, doc] of Object.entries(rawLayouts)) {
    const migrated = migrateDocument(doc, LAYOUT_SCHEMA, LAYOUT_MIGRATIONS);
    if (!isValidId(profileId) || !migrated.ok) {
      skipped.push(`Layout "${profileId}" could not be read.`);
      continue;
    }
    layouts[profileId] = sanitizeLayoutDoc(migrated.doc, profileId).value;
  }

  const themes: ThemeDoc[] = [];
  const rawThemes = Array.isArray(raw["themes"]) ? raw["themes"] : [];
  for (const entry of rawThemes) {
    const result = validateThemeDoc(entry);
    if (result.ok) themes.push(result.theme);
    else skipped.push(`A theme could not be read: ${result.errors[0] ?? "invalid"}`);
  }

  const app = isRecord(raw["app"]) ? raw["app"] : {};
  return {
    ok: true,
    skipped,
    bundle: {
      kind: BACKUP_FILE_KIND,
      schema: BACKUP_SCHEMA,
      createdAt: typeof raw["createdAt"] === "string" ? raw["createdAt"].slice(0, 40) : "",
      app: {
        name: typeof app["name"] === "string" ? app["name"].slice(0, 40) : "",
        version: typeof app["version"] === "string" ? app["version"].slice(0, 20) : "",
      },
      settings,
      layouts,
      themes,
    },
  };
}

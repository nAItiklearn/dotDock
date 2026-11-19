import { createStore, type StoreApi } from "zustand/vanilla";
import { OBSIDIAN } from "../../design-system/themes";
import { BACKUP_FILE_KIND, type BackupBundle } from "../model/backup";
import { SETTINGS_NAME, settingsCodec, themeCodec, themeName } from "../model/codecs";
import { BUILTIN_PROFILES, DEFAULT_SETTINGS, LIMITS } from "../model/defaults";
import { sanitizeSettings } from "../model/sanitize";
import { BACKUP_SCHEMA, LAYOUT_SCHEMA, type AppSettings, type LayoutDoc, type ProfileMeta } from "../model/types";
import type { StorageBackend } from "../storage/backend";
import { DocumentStore } from "../storage/documentStore";
import type { NoticeSink } from "../storage/notice";
import { parseThemeFile, slugify, themeToDoc, uniqueThemeId, validateThemeDoc, type ThemeDoc } from "../theme/schema";
import type { LayoutRepository } from "./layoutRepo";

/** How long a burst of changes (a slider drag) waits before it is written. */
const SAVE_DELAY_MS = 250;

export type ThemeImportResult =
  | { readonly ok: true; readonly theme: ThemeDoc }
  | { readonly ok: false; readonly errors: readonly string[] };

export interface SettingsState {
  readonly ready: boolean;
  readonly settings: AppSettings;
  readonly customThemes: readonly ThemeDoc[];
  init(): Promise<void>;
  /** Applies a change, clamps it into the valid range and schedules a save. */
  update(change: (settings: AppSettings) => AppSettings): void;
  flush(): Promise<void>;

  setActiveProfile(profileId: string): void;
  nextProfile(): void;
  createProfile(name: string, source: "current" | "empty"): Promise<string | null>;
  renameProfile(profileId: string, name: string): void;
  /** Returns a function that puts the profile back, or null when it cannot be deleted. */
  deleteProfile(profileId: string): Promise<(() => Promise<void>) | null>;

  saveTheme(theme: ThemeDoc): void;
  deleteTheme(themeId: string): void;
  importTheme(text: string): ThemeImportResult;
  /** A fresh id for a new custom theme named `name`. */
  newThemeId(name: string): string;

  exportBundle(app: { name: string; version: string }): Promise<BackupBundle>;
  applyBundle(bundle: BackupBundle): Promise<void>;
  resetAll(): Promise<void>;
}

export type SettingsStore = StoreApi<SettingsState>;

export interface SettingsDeps {
  readonly backend: StorageBackend;
  readonly repo: LayoutRepository;
  readonly notify: NoticeSink;
}

function uniqueProfileId(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name);
  let candidate = base;
  for (let n = 2; taken.has(candidate); n++) candidate = `${base}-${n}`;
  return candidate;
}

export function createSettingsStore({ backend, repo, notify }: SettingsDeps): SettingsStore {
  const settingsDoc = new DocumentStore(backend, SETTINGS_NAME, settingsCodec, "your settings", notify);
  const themeDocs = new Map<string, DocumentStore<ThemeDoc>>();
  const themeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let settingsTimer: ReturnType<typeof setTimeout> | null = null;
  let started = false;

  const themeStoreFor = (id: string, fallback: ThemeDoc): DocumentStore<ThemeDoc> => {
    let store = themeDocs.get(id);
    if (!store) {
      store = new DocumentStore(backend, themeName(id), themeCodec(fallback), "a custom theme", notify);
      themeDocs.set(id, store);
    }
    return store;
  };

  const fallbackTheme = (): ThemeDoc => themeToDoc(OBSIDIAN, "custom-fallback", "Fallback");

  async function loadThemes(): Promise<ThemeDoc[]> {
    const names = await backend.list("themes/");
    const loaded: ThemeDoc[] = [];
    for (const name of names) {
      const id = name.slice("themes/".length);
      const result = await themeStoreFor(id, fallbackTheme()).load();
      if (result.source === "primary" || result.source === "backup") loaded.push({ ...result.value, id });
    }
    return loaded.slice(0, LIMITS.maxCustomThemes);
  }

  return createStore<SettingsState>()((set, get) => {
    const scheduleSettingsSave = (): void => {
      if (settingsTimer !== null) clearTimeout(settingsTimer);
      settingsTimer = setTimeout(() => {
        settingsTimer = null;
        settingsDoc.save(get().settings).catch(() => undefined);
      }, SAVE_DELAY_MS);
    };

    const scheduleThemeSave = (theme: ThemeDoc): void => {
      const existing = themeTimers.get(theme.id);
      if (existing !== undefined) clearTimeout(existing);
      themeTimers.set(
        theme.id,
        setTimeout(() => {
          themeTimers.delete(theme.id);
          const latest = get().customThemes.find((t) => t.id === theme.id);
          if (latest) themeStoreFor(latest.id, latest).save(latest).catch(() => undefined);
        }, SAVE_DELAY_MS),
      );
    };

    const apply = (change: (s: AppSettings) => AppSettings): void => {
      const current = get().settings;
      const next = sanitizeSettings(change(current)).value;
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      set({ settings: next });
      scheduleSettingsSave();
    };

    return {
      ready: false,
      settings: DEFAULT_SETTINGS,
      customThemes: [],

      async init() {
        if (started) return;
        started = true;
        const [loaded, themes] = await Promise.all([settingsDoc.load(), loadThemes()]);
        set({ settings: loaded.value, customThemes: themes, ready: true });
        backend.watch((name) => {
          if (name === SETTINGS_NAME) {
            void settingsDoc.load().then((r) => set({ settings: r.value }));
          } else if (name.startsWith("themes/")) {
            void loadThemes().then((customThemes) => set({ customThemes }));
          }
        });
      },

      update: apply,

      async flush() {
        const pending: Promise<unknown>[] = [];
        if (settingsTimer !== null) {
          clearTimeout(settingsTimer);
          settingsTimer = null;
          pending.push(settingsDoc.save(get().settings));
        }
        for (const [id, timer] of themeTimers) {
          clearTimeout(timer);
          themeTimers.delete(id);
          const theme = get().customThemes.find((t) => t.id === id);
          if (theme) pending.push(themeStoreFor(id, theme).save(theme));
        }
        await Promise.all(pending);
      },

      setActiveProfile: (profileId) => apply((s) => (s.profiles.some((p) => p.id === profileId) ? { ...s, activeProfileId: profileId } : s)),

      nextProfile() {
        const { profiles, activeProfileId } = get().settings;
        const index = profiles.findIndex((p) => p.id === activeProfileId);
        const next = profiles[(index + 1) % profiles.length];
        if (next) get().setActiveProfile(next.id);
      },

      async createProfile(name, source) {
        const { settings } = get();
        const userProfiles = settings.profiles.filter((p) => !p.builtin).length;
        const cleanName = name.trim().slice(0, LIMITS.profileNameLength);
        if (cleanName === "" || userProfiles >= LIMITS.maxProfiles) return null;
        const id = uniqueProfileId(cleanName, new Set(settings.profiles.map((p) => p.id)));
        const empty: LayoutDoc = { schema: LAYOUT_SCHEMA, profileId: id, monitors: {} };
        const doc = source === "current" ? { ...(await repo.load(settings.activeProfileId)), profileId: id } : empty;
        await repo.replace(id, doc);
        apply((s) => ({ ...s, profiles: [...s.profiles, { id, name: cleanName, builtin: false }], activeProfileId: id }));
        return id;
      },

      renameProfile: (profileId, name) =>
        apply((s) => ({ ...s, profiles: s.profiles.map((p) => (p.id === profileId ? { ...p, name } : p)) })),

      async deleteProfile(profileId) {
        const { settings } = get();
        const index = settings.profiles.findIndex((p) => p.id === profileId);
        const meta = settings.profiles[index];
        if (!meta || meta.builtin) return null;
        const doc = await repo.load(profileId);
        const wasActive = settings.activeProfileId === profileId;
        await repo.remove(profileId);
        apply((s) => ({
          ...s,
          profiles: s.profiles.filter((p) => p.id !== profileId),
          activeProfileId: wasActive ? (BUILTIN_PROFILES[0]?.id ?? s.activeProfileId) : s.activeProfileId,
        }));
        return async () => {
          await repo.replace(profileId, doc);
          apply((s) => {
            const restored: ProfileMeta[] = [...s.profiles];
            restored.splice(Math.min(index, restored.length), 0, meta);
            return { ...s, profiles: restored, activeProfileId: wasActive ? profileId : s.activeProfileId };
          });
        };
      },

      saveTheme(theme) {
        const checked = validateThemeDoc(theme);
        if (!checked.ok) return;
        const clean = { ...checked.theme, id: theme.id };
        const others = get().customThemes.filter((t) => t.id !== clean.id);
        const exists = others.length !== get().customThemes.length;
        if (!exists && others.length >= LIMITS.maxCustomThemes) return;
        set({
          customThemes: exists
            ? get().customThemes.map((t) => (t.id === clean.id ? clean : t))
            : [...get().customThemes, clean],
        });
        scheduleThemeSave(clean);
      },

      deleteTheme(themeId) {
        const timer = themeTimers.get(themeId);
        if (timer !== undefined) clearTimeout(timer);
        themeTimers.delete(themeId);
        set({ customThemes: get().customThemes.filter((t) => t.id !== themeId) });
        void themeDocs.get(themeId)?.remove();
        themeDocs.delete(themeId);
        // Anything that pointed at the deleted theme goes back to the defaults instead of dangling.
        const d = DEFAULT_SETTINGS.theme;
        apply((s) => ({
          ...s,
          theme: {
            ...s.theme,
            fixedId: s.theme.fixedId === themeId ? d.fixedId : s.theme.fixedId,
            lightId: s.theme.lightId === themeId ? d.lightId : s.theme.lightId,
            darkId: s.theme.darkId === themeId ? d.darkId : s.theme.darkId,
          },
        }));
      },

      newThemeId: (name) => uniqueThemeId(name, new Set(get().customThemes.map((t) => t.id))),

      importTheme(text) {
        const parsed = parseThemeFile(text);
        if (!parsed.ok) return parsed;
        const id = get().newThemeId(parsed.theme.name);
        const theme = { ...parsed.theme, id };
        get().saveTheme(theme);
        const stored = get().customThemes.find((t) => t.id === id);
        return stored ? { ok: true, theme: stored } : { ok: false, errors: [`You can keep up to ${LIMITS.maxCustomThemes} custom themes.`] };
      },

      async exportBundle(app) {
        await get().flush();
        const { settings, customThemes } = get();
        const layouts: Record<string, LayoutDoc> = {};
        for (const profile of settings.profiles) layouts[profile.id] = await repo.load(profile.id);
        return {
          kind: BACKUP_FILE_KIND,
          schema: BACKUP_SCHEMA,
          createdAt: new Date().toISOString(),
          app,
          settings,
          layouts,
          themes: customThemes,
        };
      },

      async applyBundle(bundle) {
        await get().flush();
        const known = new Set(bundle.settings.profiles.map((p) => p.id));
        const old = get().settings.profiles.filter((p) => !p.builtin && !known.has(p.id));
        await Promise.all(old.map((p) => repo.remove(p.id)));
        for (const profile of bundle.settings.profiles) {
          await repo.replace(profile.id, bundle.layouts[profile.id] ?? { schema: LAYOUT_SCHEMA, profileId: profile.id, monitors: {} });
        }
        for (const t of get().customThemes) {
          await themeDocs.get(t.id)?.remove();
          themeDocs.delete(t.id);
        }
        set({ settings: bundle.settings, customThemes: bundle.themes.slice(0, LIMITS.maxCustomThemes) });
        scheduleSettingsSave();
        bundle.themes.forEach(scheduleThemeSave);
        await get().flush();
      },

      async resetAll() {
        const profiles = get().settings.profiles;
        for (const profile of profiles) {
          if (profile.builtin) await repo.reset(profile.id);
          else await repo.remove(profile.id);
        }
        for (const t of get().customThemes) {
          await themeDocs.get(t.id)?.remove();
          themeDocs.delete(t.id);
        }
        set({ settings: DEFAULT_SETTINGS, customThemes: [] });
        scheduleSettingsSave();
        await get().flush();
      },
    };
  });
}

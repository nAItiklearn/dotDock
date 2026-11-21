import { LIMITS } from "../model/defaults";
import type { ThemeSelection } from "../model/types";
import type { SettingsStore } from "../state/settingsStore";
import type { ThemeDoc } from "./schema";

/** The selection with `doc` chosen: as the single theme, or as the light or the dark one of an automatic mode. */
export function selectTheme(selection: ThemeSelection, doc: Pick<ThemeDoc, "id" | "mode">): ThemeSelection {
  if (selection.mode === "fixed") return { ...selection, fixedId: doc.id };
  return doc.mode === "light" ? { ...selection, lightId: doc.id } : { ...selection, darkId: doc.id };
}

export type ApplyResult =
  | { readonly ok: true; readonly undo: () => void }
  | { readonly ok: false; readonly reason: string };

/**
 * Saves the theme and makes it the one in use, everywhere at once. The returned `undo` puts back exactly
 * what was there: the theme it replaced, or no theme at all, and the previous choice of theme.
 */
export function applyWallpaperTheme(store: SettingsStore, doc: ThemeDoc): ApplyResult {
  const { settings, customThemes } = store.getState();
  const previousSelection = settings.theme;
  const previousDoc = customThemes.find((t) => t.id === doc.id);

  store.getState().saveTheme(doc);
  if (!store.getState().customThemes.some((t) => t.id === doc.id)) {
    return { ok: false, reason: `You can keep up to ${LIMITS.maxCustomThemes} custom themes. Delete one to make room.` };
  }
  store.getState().update((s) => ({ ...s, theme: selectTheme(s.theme, doc) }));

  return {
    ok: true,
    undo: () => {
      if (previousDoc) store.getState().saveTheme(previousDoc);
      else store.getState().deleteTheme(doc.id);
      // Deleting resets anything that pointed at the theme to the defaults; the previous choice goes back after.
      store.getState().update((s) => ({ ...s, theme: previousSelection }));
    },
  };
}

import { pageById, type PageId } from "./pageMeta";

export interface SearchEntry {
  /** Matches the `id` of a Row (or section anchor) on the page, so the result can scroll to it. */
  readonly id: string;
  readonly page: PageId;
  readonly title: string;
  /** Extra words people might type that the title does not contain. */
  readonly keywords: string;
}

const e = (page: PageId, id: string, title: string, keywords = ""): SearchEntry => ({ page, id, title, keywords });

/** Every setting a person can look for. Each id is a Row id on its page; a test keeps the two in step. */
export const SEARCH_ENTRIES: readonly SearchEntry[] = [
  e("home", "profiles", "Layout profiles", "work focus minimal switch scene preset new duplicate rename delete reset"),
  e("home", "edit-layout", "Edit layout", "arrange drag move resize widgets desktop"),
  e("home", "layout-widgets", "Widgets on this profile", "list remove delete add per display"),
  e("home", "collision", "When widgets collide", "push swap overlap bump"),
  e("home", "guides", "Alignment guides", "snap lines align"),
  e("home", "lock", "Lock layout", "freeze prevent changes accidental"),
  e("home", "gap", "Widget spacing", "gap gutter between"),
  e("home", "edge", "Screen edge margin", "safe area padding border"),
  e("home", "display-layouts", "Layouts per display", "monitor screen clear copy"),

  e("modules", "module-home", "Home screen", "module widgets overlay desktop turn off disable enable switch on"),
  e("modules", "module-dock", "Dock", "module launcher apps stacks bar turn off disable enable switch on"),
  e("modules", "module-taskbar", "Replace the taskbar", "module hide windows taskbar dock restore turn off disable enable"),
  e("modules", "module-notch", "Notch", "module agent island claude codex ai coding pill turn off disable enable"),

  e("appearance", "theme", "Theme", "obsidian paper aurum colour color dark light palette"),
  e("appearance", "theme-switch", "Switch automatically", "system windows schedule time day night light dark follow"),
  e("appearance", "custom-themes", "Your themes", "editor create import export json accent oklch contrast custom"),
  e("appearance", "radius", "Corner roundness", "radius shape round square cards"),
  e("appearance", "motion", "Motion", "animation reduce reduced still"),
  e("appearance", "motion-speed", "Animation speed", "fast slow transitions"),
  e("appearance", "font", "Interface font", "typeface mono sans geist"),

  e("wallpapers", "wallpaper-library", "Wallpaper library", "image background import desktop picture"),
  e("wallpapers", "wallpaper-fit", "Fit mode", "fill fit stretch tile center span"),

  e("widgets", "gallery", "Add a widget", "gallery preview clock date calendar weather battery memory disk"),

  e("startup", "use-desktop", "Use this desktop", "windows stock switch back replace"),
  e("startup", "launch", "Launch at sign-in", "startup autostart boot login"),
  e("startup", "desktop-icons", "Hide desktop icons", "shortcuts files clutter"),
  e("startup", "restore", "Restore Windows desktop", "panic undo revert original wallpaper icons"),
  e("startup", "boot-timing", "Boot timing", "speed startup seconds measure"),

  e("displays", "display-list", "Displays and safe margins", "monitor screen resolution scaling dpi refresh edge padding taskbar"),

  e("performance", "pause-rules", "Pause rules", "fullscreen game battery saver lock"),
  e("performance", "refresh", "System data refresh", "hz rate cpu memory update"),
  e("performance", "frame-stats", "Frame stats", "fps frame time cpu memory usage"),

  e("shortcuts", "shortcut-toggleEditMode", "Edit layout hotkey", "keyboard global bind"),
  e("shortcuts", "shortcut-openSettings", "Open Settings hotkey", "keyboard global bind"),
  e("shortcuts", "shortcut-nextProfile", "Next profile hotkey", "keyboard global bind switch cycle"),
  e("shortcuts", "edit-keys", "Keys while editing", "undo redo duplicate delete nudge arrows resize escape"),

  e("data", "stored", "What is stored", "files location folder disk"),
  e("data", "export", "Export everything", "backup save download json"),
  e("data", "import", "Import a backup", "restore load upload json"),
  e("data", "reset", "Reset everything", "factory defaults wipe clear"),
  e("data", "cache", "Cached data", "cache clear delete weather battery"),
  e("data", "network", "Network use", "privacy internet weather open-meteo telemetry analytics updates"),

  e("about", "version", "Version", "build release"),
  e("about", "updates", "Updates", "check new version"),
  e("about", "diagnostics", "Diagnostics", "copy report support bug"),
  e("about", "licences", "Licences", "license third party notices fonts open source"),
  e("about", "attribution", "Credits and attribution", "open-meteo weather nothing affiliated"),
];

export interface SearchHit extends SearchEntry {
  readonly pageTitle: string;
}

/** Every word of the query must appear somewhere in the title, keywords or page name. Title hits rank first. */
export function searchSettings(query: string, entries: readonly SearchEntry[] = SEARCH_ENTRIES): readonly SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { hit: SearchHit; score: number }[] = [];
  for (const entry of entries) {
    const pageTitle = pageById(entry.page).title;
    const title = entry.title.toLowerCase();
    const rest = `${entry.keywords} ${pageTitle}`.toLowerCase();
    let score = 0;
    let all = true;
    for (const word of words) {
      if (title.startsWith(word)) score += 4;
      else if (title.includes(word)) score += 3;
      else if (rest.includes(word)) score += 1;
      else all = false;
    }
    if (all) scored.push({ hit: { ...entry, pageTitle }, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.hit);
}

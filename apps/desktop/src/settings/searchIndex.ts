import { pageById, sectionById, type PageId } from "./sections";

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
  e("startup", "launch", "Launch at sign-in", "startup autostart boot login windows"),
  e("startup", "desktop-icons", "Hide desktop icons", "shortcuts files clutter"),
  e("startup", "startup-delay", "Windows startup delay", "wait seconds boot slow"),

  e("about", "version", "Version", "build release"),
  e("about", "licences", "Licences", "license third party notices fonts open source"),
  e("about", "attribution", "Credits and attribution", "open-meteo weather nothing affiliated"),

  e("layout", "edit-layout", "Edit layout", "arrange drag move resize widgets desktop"),
  e("layout", "layout-widgets", "Widgets on this profile", "list remove delete add per display"),
  e("layout", "collision", "When widgets collide", "push swap overlap bump"),
  e("layout", "guides", "Alignment guides", "snap lines align"),
  e("layout", "lock", "Lock layout", "freeze prevent changes accidental"),
  e("layout", "gap", "Widget spacing", "gap gutter between grid"),
  e("layout", "edge", "Screen edge margin", "safe area padding border"),
  e("layout", "display-layouts", "Layouts per display", "monitor screen clear copy"),

  e("profiles", "profiles", "Layout profiles", "work focus minimal switch scene preset rename delete reset use"),
  e("profiles", "new-profile", "New profile", "create add duplicate copy empty"),

  e("widgets", "gallery", "Add a widget", "gallery preview clock date calendar weather battery memory disk"),

  e("displays", "display-list", "Displays and safe margins", "monitor screen resolution scaling dpi refresh edge padding taskbar"),

  e("dock-items", "dock-add-app", "Keep an app on the dock", "pin dock app add launcher favourite"),
  e("dock-tiles", "dock-add-tile", "Add a dock tile", "widget live tile clock media system"),
  e("dock-look", "dock-theme", "Dock theme", "glass blur acrylic obsidian paper aurum minimal bar look"),
  e("dock-behaviour", "dock-icon-size", "Dock icon size", "bigger smaller scale"),
  e("dock-behaviour", "dock-magnification", "Dock magnification", "zoom grow hover"),
  e("dock-behaviour", "dock-auto-hide", "Hide the dock automatically", "autohide auto-hide slide"),
  e("dock-taskbar", "dock-reserve-space", "Keep windows clear of the dock", "maximise maximize app bar reserve space overlap"),
  e("dock-taskbar", "dock-windows-taskbar", "Windows taskbar and the dock", "replace taskbar"),

  e("agents", "agent-claude", "Claude Code", "agent connect disconnect hooks notch island ai"),
  e("agents", "agent-codex", "Codex", "agent openai logs notch island ai"),
  e("agents", "done-linger", "Keep a finished task visible", "linger done seconds"),
  e("agents", "sound", "Play a sound when a task finishes", "chime alert notification done"),
  e("agents", "volume", "Chime volume", "sound loud quiet"),

  e("notch-look", "notch-idle", "When nothing is running", "idle tiny pill hidden"),
  e("notch-look", "notch-style", "Dot style", "icon dots blocks stripes"),
  e("notch-look", "notch-scale", "Notch size", "scale bigger smaller"),
  e("notch-look", "notch-offset", "Distance from the top edge", "offset position gap"),
  e("notch-look", "notch-detail", "Current file or command", "detail show"),
  e("notch-look", "notch-tokens", "Tokens this turn", "count usage show"),
  e("notch-look", "notch-elapsed", "Elapsed time", "timer duration show"),
  e("notch-look", "notch-project", "Project name", "folder repository show"),
  e("notch-look", "notch-scene", "Creature and landscape", "beetle scene strip"),
  e("notch-look", "notch-aside", "Move aside when the cursor is over it", "hover slide"),
  e("notch-look", "notch-follow", "Follow the cursor to other monitors", "multi monitor screen"),

  e("themes", "theme", "Theme", "obsidian paper aurum colour color dark light palette"),
  e("themes", "wallpaper-theme", "Theme from your wallpaper", "palette colours colors extract generate auto tint picture image desktop background accent apply undo"),
  e("themes", "theme-switch", "Switch automatically", "system windows schedule time day night light dark follow"),
  e("themes", "custom-themes", "Your themes", "editor create import export json accent oklch contrast custom"),
  e("themes", "radius", "Corner roundness", "radius shape round square cards"),
  e("themes", "motion", "Motion", "animation reduce reduced still"),
  e("themes", "motion-speed", "Animation speed", "fast slow transitions"),
  e("themes", "font", "Interface font", "typeface mono sans"),

  e("wallpapers", "wallpaper-library", "Wallpaper library", "image background import desktop picture"),
  e("wallpapers", "wallpaper-fit", "Fit mode", "fill fit stretch tile center span"),

  e("recovery", "environment-on", "dotDock theme", "turn off disable enable whole environment theme widgets dock notch wallpaper plain windows stock switch restore"),
  e("recovery", "windows-taskbar", "Use the Windows taskbar", "hide replace dock taskbar real native bar restore advanced"),

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

  e("recovery", "restore", "Restore Windows desktop", "panic undo revert original wallpaper icons way back"),
  e("recovery", "open-folder", "Logs and data folder", "boot.log panic log open explorer"),
  e("recovery", "diagnostics", "Diagnostics", "copy report support bug"),
  e("recovery", "boot-timing", "Boot timing", "speed startup seconds measure"),
];

export interface SearchHit extends SearchEntry {
  /** Where the setting lives, for example "Home screen · Layout". */
  readonly where: string;
}

function whereOf(page: PageId): string {
  const meta = pageById(page);
  return `${sectionById(meta.section).title} · ${meta.title}`;
}

/** Every word of the query must appear somewhere in the title, keywords or page name. Title hits rank first. */
export function searchSettings(query: string, entries: readonly SearchEntry[] = SEARCH_ENTRIES): readonly SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { hit: SearchHit; score: number }[] = [];
  for (const entry of entries) {
    const where = whereOf(entry.page);
    const title = entry.title.toLowerCase();
    const rest = `${entry.keywords} ${where}`.toLowerCase();
    let score = 0;
    let all = true;
    for (const word of words) {
      if (title.startsWith(word)) score += 4;
      else if (title.includes(word)) score += 3;
      else if (rest.includes(word)) score += 1;
      else all = false;
    }
    if (all) scored.push({ hit: { ...entry, where }, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.hit);
}

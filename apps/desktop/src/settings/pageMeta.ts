import type { IconName } from "../lib/ui/Icon";

export type PageId =
  | "home"
  | "appearance"
  | "wallpapers"
  | "widgets"
  | "startup"
  | "displays"
  | "performance"
  | "shortcuts"
  | "data"
  | "about";

export interface PageMeta {
  readonly id: PageId;
  readonly title: string;
  readonly icon: IconName;
  readonly description: string;
  /** True when the page needs the desktop app (Rust core) to do anything. */
  readonly needsApp: boolean;
}

/** Settings pages in sidebar order. */
export const PAGES: readonly PageMeta[] = [
  { id: "home", title: "Home", icon: "home", needsApp: false, description: "Layout profiles, the widgets on your desktop, and how editing behaves." },
  { id: "appearance", title: "Appearance", icon: "appearance", needsApp: false, description: "Themes, colours, shape and motion. The desktop updates as you change them." },
  { id: "wallpapers", title: "Wallpapers", icon: "wallpaper", needsApp: true, description: "Choose what sits behind your widgets, display by display." },
  { id: "widgets", title: "Widgets", icon: "widgets", needsApp: false, description: "Every widget, live. Add one to the active profile." },
  { id: "startup", title: "Startup & Windows", icon: "power", needsApp: true, description: "How the app starts with Windows, and the way back to the stock desktop." },
  { id: "displays", title: "Displays", icon: "display", needsApp: true, description: "Resolution and scaling of each screen, and how close widgets may get to its edges." },
  { id: "performance", title: "Performance", icon: "gauge", needsApp: true, description: "When the desktop pauses itself, and how often system data refreshes." },
  { id: "shortcuts", title: "Shortcuts", icon: "keyboard", needsApp: false, description: "Global hotkeys, and the keys that work while you edit." },
  { id: "data", title: "Data & privacy", icon: "privacy", needsApp: false, description: "What is stored and where, and how to back it up or wipe it." },
  { id: "about", title: "About", icon: "info", needsApp: false, description: "Version, licences and credits." },
];

export function isPageId(value: string): value is PageId {
  return PAGES.some((p) => p.id === value);
}

export function pageById(id: PageId): PageMeta {
  return PAGES.find((p) => p.id === id) ?? (PAGES[0] as PageMeta);
}

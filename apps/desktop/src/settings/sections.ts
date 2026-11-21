import type { IconName } from "../lib/ui/Icon";

/**
 * Settings is organised by part of the product (docs/design/SETTINGS_IA.md): one section per part,
 * each with its pages as tabs. A section with no pages on this build is left out of the sidebar.
 */
export type SectionId = "general" | "home" | "dock" | "notch" | "themes" | "system";

export type PageId =
  | "startup"
  | "about"
  | "layout"
  | "profiles"
  | "widgets"
  | "displays"
  | "agents"
  | "notch-look"
  | "themes"
  | "wallpapers"
  | "shortcuts"
  | "data"
  | "recovery";

export interface SectionMeta {
  readonly id: SectionId;
  readonly title: string;
  readonly icon: IconName;
}

export interface PageMeta {
  readonly id: PageId;
  readonly section: SectionId;
  /** The tab label. */
  readonly title: string;
  readonly icon: IconName;
  readonly description: string;
}

/** Sidebar order. */
const ALL_SECTIONS: readonly SectionMeta[] = [
  { id: "general", title: "General", icon: "settings" },
  { id: "home", title: "Home screen", icon: "home" },
  { id: "dock", title: "Dock", icon: "dock" },
  { id: "notch", title: "Notch", icon: "notch" },
  { id: "themes", title: "Themes & wallpaper", icon: "appearance" },
  { id: "system", title: "System & safety", icon: "privacy" },
];

/** Every page, grouped by section in tab order. */
export const PAGES: readonly PageMeta[] = [
  { id: "startup", section: "general", title: "Startup", icon: "power", description: "How the app starts with Windows." },
  { id: "about", section: "general", title: "About", icon: "info", description: "Version, credits and licences." },

  { id: "layout", section: "home", title: "Layout", icon: "home", description: "The widgets on your desktop, and how they behave while you arrange them." },
  { id: "profiles", section: "home", title: "Profiles", icon: "layers", description: "Complete arrangements of widgets you can switch between." },
  { id: "widgets", section: "home", title: "Widgets", icon: "widgets", description: "Every widget, live. Add one to the active profile." },
  { id: "displays", section: "home", title: "Displays", icon: "display", description: "Each screen's resolution and scaling, and how close widgets may get to its edges." },

  { id: "agents", section: "notch", title: "Agents", icon: "notch", description: "The coding agents the notch follows, and how it tells you a task is done." },
  { id: "notch-look", section: "notch", title: "Appearance", icon: "appearance", description: "Where the notch sits, how big it is, and what it shows." },

  { id: "themes", section: "themes", title: "Themes", icon: "appearance", description: "Themes, colours, shape and motion. The desktop updates as you change them." },
  { id: "wallpapers", section: "themes", title: "Wallpapers", icon: "wallpaper", description: "Choose what sits behind your widgets, display by display." },

  { id: "shortcuts", section: "system", title: "Shortcuts", icon: "keyboard", description: "Global hotkeys, and the keys that work while you edit." },
  { id: "data", section: "system", title: "Data and privacy", icon: "privacy", description: "What is stored and where, and how to back it up or wipe it." },
  { id: "recovery", section: "system", title: "Recovery and logs", icon: "restore", description: "The way back to the stock Windows desktop, and what to send with a bug report." },
];

/** Sections that have at least one page on this build, in sidebar order. */
export const SECTIONS: readonly SectionMeta[] = ALL_SECTIONS.filter((s) => PAGES.some((p) => p.section === s.id));

export function isPageId(value: string): value is PageId {
  return PAGES.some((p) => p.id === value);
}

export function isSectionId(value: string): value is SectionId {
  return SECTIONS.some((s) => s.id === value);
}

export function pageById(id: PageId): PageMeta {
  return PAGES.find((p) => p.id === id) ?? (PAGES[0] as PageMeta);
}

export function sectionById(id: SectionId): SectionMeta {
  return SECTIONS.find((s) => s.id === id) ?? (SECTIONS[0] as SectionMeta);
}

export function pagesOf(section: SectionId): readonly PageMeta[] {
  return PAGES.filter((p) => p.section === section);
}

/** The link to a page, optionally scrolling to and flashing one setting on it. */
export function hrefFor(page: PageId, focus?: string): string {
  const { section } = pageById(page);
  return `#/${section}/${page}${focus ? `?focus=${focus}` : ""}`;
}

/** v1 page ids that no longer exist, and where their content lives now. */
const LEGACY_PAGES: Readonly<Record<string, PageId>> = {
  home: "layout",
  appearance: "themes",
};

export interface Route {
  readonly page: PageId;
  readonly focus: string | null;
}

/**
 * Reads `#/<section>/<page>?focus=<id>`. A bare section opens its first page; a v1 route
 * (`#/<page>`) opens the page's new home; anything unknown opens the first page of all.
 */
export function parseRoute(hash: string): Route {
  const match = /^#\/([a-z-]+)(?:\/([a-z-]+))?(?:\?focus=([\w-]+))?/.exec(hash);
  const first = match?.[1] ?? "";
  const second = match?.[2];
  const focus = match?.[3] ?? null;
  if (second && isPageId(second) && pageById(second).section === first) return { page: second, focus };
  if (!second && isSectionId(first)) {
    const legacy = LEGACY_PAGES[first];
    // "home" is both a v1 page id and a section id; both mean the same place.
    return { page: legacy ?? (pagesOf(first)[0] as PageMeta).id, focus };
  }
  if (!second) {
    const legacy = LEGACY_PAGES[first];
    if (legacy) return { page: legacy, focus };
    if (isPageId(first)) return { page: first, focus };
  }
  return { page: (PAGES[0] as PageMeta).id, focus };
}

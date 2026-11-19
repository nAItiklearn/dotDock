import type { BuiltinCategoryId, Category } from "./protocol";

/** English copy. Every string the dock shows lives here so a translation is one more dictionary. */
const EN = {
  "dock.label": "Dock",
  "library.open": "App Library",
  "library.title": "App Library",
  "library.search": "Search apps",
  "library.search.label": "Search apps",
  "library.close": "Close App Library",
  "library.empty.title": "No apps match “{query}”",
  "library.empty.hint": "Try a shorter name, a publisher or a category.",
  "library.none.title": "No apps yet",
  "library.none.hint": "Apps appear here once the Start menu has been read.",
  "library.count.one": "{count} app",
  "library.count.other": "{count} apps",
  "library.result.copy": "Copy result",
  "library.result.copied": "Copied",

  "stack.filter": "Type to filter",
  "stack.empty.title": "Nothing filed here",
  "stack.empty.hint": "Apps you file in this category show up in this stack.",
  "stack.nomatch": "No match for “{query}”",
  "stack.close": "Close stack",
  "stack.new.one": "{count} new",
  "stack.new.other": "{count} new",

  "item.new": "New",
  "item.running.one": "{count} window",
  "item.running.other": "{count} windows",

  "menu.open": "Open",
  "menu.newWindow": "New window",
  "menu.pin": "Keep in dock",
  "menu.unpin": "Remove from dock",
  "menu.moveToStack": "Move to stack",
  "menu.closeWindow": "Close window",
  "menu.closeAll": "Close all windows",
  "menu.openStack": "Open stack",
  "menu.removeStack": "Remove stack",
  "menu.editDock": "Edit dock",
  "menu.doneEditing": "Done editing",
  "menu.library": "Show App Library",
  "menu.removeTile": "Remove tile",

  "edit.done": "Done",
  "edit.add": "Add to dock",
  "edit.add.stacks": "Stacks",
  "edit.add.tiles": "Live tiles",
  "edit.add.none": "Everything is on the dock already.",
  "edit.remove": "Remove {name}",
  "edit.hint": "Drag to reorder. Drop an app on a stack to file it there.",

  "tile.clock": "Clock",
  "tile.media": "Now playing",
  "tile.system": "System",
  "tile.media.idle": "Nothing playing",
  "tile.media.play": "Play",
  "tile.media.pause": "Pause",
  "tile.system.memory": "Memory",

  "status.label": "Status",
  "status.online": "Online",
  "status.offline": "Offline",
  "status.battery": "Battery {percent}%",
  "status.battery.charging": "Battery {percent}%, charging",

  "launch.failed": "Could not open {name}",
  "activate.failed": "Could not switch to {name}",
  "setting.failed": "Could not save the change",

  "preview.windows.one": "{count} window",
  "preview.windows.other": "{count} windows",
  "preview.more": "{count} more",
  "preview.untitled": "Untitled window",
  "preview.minimized": "Minimised",
} as const;

export type StringKey = keyof typeof EN;

export function t(key: StringKey, vars?: Readonly<Record<string, string | number>>): string {
  let text: string = EN[key];
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

const plurals = new Intl.PluralRules("en");

/** "3 apps" / "1 app": picks the `.one` or `.other` string by the count's plural category. */
export function plural(base: "library.count" | "stack.new" | "item.running" | "preview.windows", count: number): string {
  const form = plurals.select(count) === "one" ? "one" : "other";
  return t(`${base}.${form}` as StringKey, { count });
}

const BUILTIN_NAMES: Record<BuiltinCategoryId, string> = {
  productivity: "Productivity",
  communication: "Communication",
  development: "Development",
  ai: "AI",
  creative: "Creative",
  browsers: "Browsers",
  media: "Media",
  games: "Games",
  utilities: "Utilities",
  system: "System",
  other: "Other",
};

const CUSTOM_FALLBACK = "Stack";

/** The name shown for a category: the user's own, else the built-in name for its id. */
export function categoryLabel(category: Pick<Category, "id" | "name">): string {
  if (category.name !== null && category.name.trim() !== "") return category.name;
  return (BUILTIN_NAMES as Record<string, string | undefined>)[category.id] ?? CUSTOM_FALLBACK;
}

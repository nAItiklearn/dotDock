import { MENU } from "./geometry";
import { categoryLabel, t } from "./strings";
import { isTileId, pin, unpin } from "./model";
import type { Category, CategoryId, CategoryTone, DockApp, DockSettings, DockWindow, PinnedItem } from "./protocol";
export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly kind: "item" | "separator" | "heading" | "submenu";
  readonly children?: readonly MenuItem[];
  readonly checked?: boolean;
  readonly danger?: boolean;
  /** Tone of the dot shown before a category row. */
  readonly tone?: CategoryTone;
  readonly run?: () => void;
}

/** What a menu entry can do. The dock supplies the real thing; tests supply a recorder. */
export interface MenuActions {
  readonly launch: (appId: string, name: string) => void;
  readonly closeWindows: (hwnds: readonly string[]) => void;
  readonly setCategory: (appId: string, category: CategoryId) => void;
  readonly updateSettings: (patch: Partial<DockSettings>) => void;
  readonly openStack: (category: CategoryId) => void;
  readonly setLibrary: (open: boolean) => void;
  readonly setEditing: (editing: boolean) => void;
  /** Opens the widget gallery, where tiles and stacks are added to the dock. */
  readonly openGallery: () => void;
  /** Opens the dock settings popover. */
  readonly openSettings: () => void;
}

export interface MenuContext {
  readonly settings: DockSettings;
  readonly categories: readonly Category[];
  readonly apps: readonly DockApp[];
  readonly windows: readonly DockWindow[];
  readonly editing: boolean;
  readonly do: MenuActions;
}

const separator = (id: string): MenuItem => ({ id, label: "", kind: "separator" });

function barMenu(ctx: MenuContext): MenuItem[] {
  return [
    ctx.editing
      ? { id: "edit", label: t("menu.doneEditing"), kind: "item", run: () => ctx.do.setEditing(false) }
      : { id: "edit", label: t("menu.editDock"), kind: "item", run: () => ctx.do.setEditing(true) },
    { id: "widgets", label: t("menu.addWidget"), kind: "item", run: () => ctx.do.openGallery() },
    { id: "settings", label: t("menu.settings"), kind: "item", run: () => ctx.do.openSettings() },
    { id: "library", label: t("menu.library"), kind: "item", run: () => ctx.do.setLibrary(true) },
  ];
}

function moveToStack(app: DockApp, ctx: MenuContext): MenuItem {
  const children = [...ctx.categories]
    .sort((a, b) => a.order - b.order)
    .map<MenuItem>((c) => ({
      id: `move:${c.id}`,
      label: categoryLabel(c),
      kind: "item",
      tone: c.tone,
      checked: c.id === app.category,
      run: () => ctx.do.setCategory(app.id, c.id),
    }));
  return { id: "move", label: t("menu.moveToStack"), kind: "submenu", children };
}

function closeItems(windows: readonly DockWindow[], ctx: MenuContext): MenuItem[] {
  if (windows.length === 0) return [];
  const hwnds = windows.map((w) => w.hwnd);
  return [
    separator("s-close"),
    {
      id: "close",
      label: windows.length === 1 ? t("menu.closeWindow") : `${t("menu.closeAll")} (${windows.length})`,
      kind: "item",
      danger: true,
      run: () => ctx.do.closeWindows(hwnds),
    },
  ];
}

function appMenu(app: DockApp, windows: readonly DockWindow[], ctx: MenuContext): MenuItem[] {
  const pinned = ctx.settings.pinned.some((p) => p.kind === "app" && p.id === app.id);
  const item: PinnedItem = { kind: "app", id: app.id };
  return [
    { id: "open", label: windows.length > 0 ? t("menu.newWindow") : t("menu.open"), kind: "item", run: () => ctx.do.launch(app.id, app.name) },
    pinned
      ? { id: "pin", label: t("menu.unpin"), kind: "item", run: () => ctx.do.updateSettings({ pinned: unpin(ctx.settings.pinned, item) }) }
      : { id: "pin", label: t("menu.pin"), kind: "item", run: () => ctx.do.updateSettings({ pinned: pin(ctx.settings.pinned, item) }) },
    moveToStack(app, ctx),
    ...closeItems(windows, ctx),
  ];
}

/**
 * The items of the menu for an entry key (the bar's own keys, plus `app:<id>` for apps in a popover or the
 * library). `null` is the bar itself; unknown keys fall back to it.
 */
export function menuFor(key: string | null, ctx: MenuContext): MenuItem[] {
  if (key === null || key === "library" || key === "status") return barMenu(ctx);

  if (key.startsWith("stack:")) {
    const category = key.slice("stack:".length) as CategoryId;
    return [
      { id: "open", label: t("menu.openStack"), kind: "item", run: () => ctx.do.openStack(category) },
      {
        id: "remove",
        label: t("menu.removeStack"),
        kind: "item",
        run: () => ctx.do.updateSettings({ pinned: unpin(ctx.settings.pinned, { kind: "stack", category }) }),
      },
    ];
  }

  if (key.startsWith("tile:")) {
    const id = key.slice("tile:".length);
    if (!isTileId(id)) return barMenu(ctx);
    return [{ id: "remove", label: t("menu.removeTile"), kind: "item", run: () => ctx.do.updateSettings({ tiles: ctx.settings.tiles.filter((tile) => tile !== id) }) }];
  }

  if (key.startsWith("app:")) {
    const app = ctx.apps.find((a) => `app:${a.id}` === key);
    if (!app) return barMenu(ctx);
    return appMenu(app, ctx.windows.filter((w) => w.appId === app.id), ctx);
  }

  if (key.startsWith("exe:")) {
    const windows = ctx.windows.filter((w) => w.appId === null && `exe:${w.icon}` === key);
    return windows.length === 0 ? barMenu(ctx) : closeItems(windows, ctx).slice(1);
  }
  return barMenu(ctx);
}

const ROW_HEIGHT: Record<MenuItem["kind"], number> = { item: MENU.row, submenu: MENU.row, heading: MENU.heading, separator: MENU.separator };

/** Height of the first `count` rows. */
export function heightBefore(items: readonly MenuItem[], count: number): number {
  return items.slice(0, count).reduce((sum, item) => sum + ROW_HEIGHT[item.kind], 0);
}

export function menuSize(items: readonly MenuItem[]): { readonly w: number; readonly h: number } {
  return { w: MENU.w, h: heightBefore(items, items.length) + 2 * MENU.pad };
}

/** Indices of the rows the keyboard can land on. */
export const actionable = (items: readonly MenuItem[]): number[] =>
  items.flatMap((item, i) => (item.kind === "item" || item.kind === "submenu" ? [i] : []));


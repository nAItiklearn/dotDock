/**
 * The dock's contract between the Rust core (crate `dotdock-dock`, host `dock_host.rs`) and the dock
 * window (`dock.html`, `src/dock`). Rust mirrors every type with serde `rename_all = "camelCase"`.
 * Changing anything here is a breaking change for both sides: update `docs/dock/CONTRACT.md` too.
 */

/** Built-in category ids. Users can add their own (`custom:<uuid>`), so ids are strings on the wire. */
export const BUILTIN_CATEGORIES = [
  "productivity",
  "communication",
  "development",
  "ai",
  "creative",
  "browsers",
  "media",
  "games",
  "utilities",
  "system",
  "other",
] as const;
export type BuiltinCategoryId = (typeof BUILTIN_CATEGORIES)[number];
export type CategoryId = BuiltinCategoryId | `custom:${string}`;

export interface Category {
  readonly id: CategoryId;
  /** Display name; built-ins are localised in the UI from their id unless the user renamed them. */
  readonly name: string | null;
  /** Theme tone the stack is tinted with. */
  readonly tone: CategoryTone;
  /** Position among stacks, lowest first. */
  readonly order: number;
}

export type CategoryTone = "accent" | "red" | "amber" | "green" | "teal" | "blue" | "violet" | "pink" | "neutral";

/** How an app was put in its category, so the UI can show "filed automatically" and let the user override. */
export type FiledBy = "user" | "known" | "store" | "rule" | "fallback";

/** One launchable app: a Start menu shortcut or an installed Store/packaged app. */
export interface DockApp {
  /** Stable id: the AppUserModelID when there is one, else the normalised target path. */
  readonly id: string;
  readonly name: string;
  readonly category: CategoryId;
  readonly filedBy: FiledBy;
  /** `dock-icon://<hash>.png` URL served by the core (256 px PNG, cached in %LOCALAPPDATA%). */
  readonly icon: string;
  /** Publisher or company name when known, for search and the info line. */
  readonly publisher: string | null;
  /** Epoch ms the app was first seen, so new installs can be badged. */
  readonly firstSeen: number;
}

/** A top-level window that belongs on the dock (visible, not a tool window, not cloaked). */
export interface DockWindow {
  /** HWND as a decimal string (JSON numbers cannot hold every 64-bit handle safely). */
  readonly hwnd: string;
  /** `DockApp.id` the window belongs to, or null for an app with no Start menu entry. */
  readonly appId: string | null;
  readonly title: string;
  /** Icon of the window's executable, for running apps that are not in the catalogue. */
  readonly icon: string;
  readonly minimized: boolean;
  readonly focused: boolean;
  /** Taskbar progress or attention state, when the app sets one. */
  readonly flashing: boolean;
}

/**
 * The dock is fixed to the bottom of the screen: it is the taskbar. The core's `DockSettings.edge` still has the
 * older top, left and right values and still requires the field, so the UI keeps it on the wire, always sends
 * "bottom", and pins anything else it receives to "bottom" (`normaliseSettings` in store.ts). Nothing in the UI
 * reads it; the host track can treat the core field as ignored by the UI.
 */
export type DockEdge = "bottom";

export interface DockSettings {
  readonly schema: 1;
  /** Master switch. Off = the dock window is hidden and the Windows taskbar is left alone. */
  readonly enabled: boolean;
  /** Hide the native taskbar while the dock runs. Off by default until the owner has reviewed it. */
  readonly replaceTaskbar: boolean;
  /** Always "bottom" in the UI; see `DockEdge`. */
  readonly edge: DockEdge;
  /** Reserve screen space (app bar) so maximised windows stop at the dock; false floats over them. */
  readonly reserveSpace: boolean;
  readonly autoHide: boolean;
  /** Icon size in px at 100 % scaling. */
  readonly iconSize: number;
  /** Peak magnification factor; 1 turns it off. */
  readonly magnification: number;
  /** Ordered pinned items: app ids and category stacks. */
  readonly pinned: readonly PinnedItem[];
  /** Live tile ids shown on the right, in order. */
  readonly tiles: readonly string[];
}

export type PinnedItem = { readonly kind: "app"; readonly id: string } | { readonly kind: "stack"; readonly category: CategoryId };

export interface DockSnapshot {
  readonly categories: readonly Category[];
  readonly apps: readonly DockApp[];
  readonly windows: readonly DockWindow[];
  readonly settings: DockSettings;
}

/** Commands the dock window invokes. Every one resolves; failures come back as `{ ok: false, reason }`. */
export interface DockCommands {
  dock_ready(): DockSnapshot;
  dock_launch(args: { appId: string }): CommandResult;
  /** Click on a running app: restore and focus, or minimise if it is already focused. */
  dock_activate(args: { hwnd: string }): CommandResult;
  dock_close_window(args: { hwnd: string }): CommandResult;
  dock_set_category(args: { appId: string; category: CategoryId }): CommandResult;
  dock_save_categories(args: { categories: readonly Category[] }): CommandResult;
  dock_set_settings(args: { settings: DockSettings }): CommandResult;
  /** Rectangles (CSS px, window-relative) that take the pointer; everything else clicks through. */
  dock_set_regions(args: { rects: readonly { x: number; y: number; w: number; h: number }[] }): void;
  /** Show or hide live DWM thumbnails of an app's windows above a rect of the dock window. */
  dock_preview(args: { hwnds: readonly string[]; anchor: { x: number; y: number; w: number; h: number } } | { hwnds: [] }): void;
  /**
   * The dock window never activates on its own. While a text field, a popover or edit mode needs keys the UI asks
   * for the foreground with `active: true` and hands it back with `false` (same idea as the overlay's `overlay_set_typing`).
   */
  dock_set_focus(args: { active: boolean }): void;
}

export type CommandResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** What the core knows about the area behind the dock: whether the native blur can be applied and how light it is. */
export interface DockBackdrop {
  /** The native blur can be applied: Windows 11 22H2 or later, or the Windows 10 acrylic fallback. */
  readonly available: boolean;
  /** Whether the desktop behind the dock is light or dark; null while the core has not measured it. */
  readonly tone: "light" | "dark" | null;
  /** Windows battery saver is on: the dock drops transparency to save power. */
  readonly saver: boolean;
}

/**
 * When the dock should stop rendering: the session is locked, the display is off, or a fullscreen app
 * (a game, a presentation) has the foreground. Any true means freeze all animation loops.
 */
export interface FrozenState {
  readonly locked: boolean;
  readonly displayOff: boolean;
  readonly fullscreen: boolean;
}

/** Events the core emits to the dock window. */
export interface DockEvents {
  "dock://apps": readonly DockApp[];
  "dock://windows": readonly DockWindow[];
  "dock://settings": DockSettings;
  /** The global App Library shortcut was pressed. */
  "dock://library": "toggle" | "open" | "close";
  /**
   * The cursor entered or left the rectangles from `dock_set_regions`. A click-through window gets no `pointerleave`
   * from the WebView, so the core, which already polls the cursor, reports it.
   */
  "dock://pointer": { readonly inside: boolean };
  /** The core froze the dock: the UI stops every frame loop and timer while any field is true, so a hidden dock costs nothing. */
  "dock://frozen": FrozenState;
  /** The blur and tone of what is behind the dock changed (a new wallpaper, battery saver, a transparency setting). */
  "dock://backdrop": DockBackdrop;
}

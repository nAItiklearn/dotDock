import { centredOrigin } from "../lib/layout/gesture";
import type { Cell } from "../lib/model/types";
import { getApp } from "../lib/state/app";
import type { LayoutStore } from "../lib/state/layoutStore";
import type { IconName } from "../lib/ui/Icon";
import type { SizeSpec } from "../widgets/sizes";
import { announce, editUi } from "./editUi";

let undoTokens = 0;

function slotElement(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-slot-id="${CSS.escape(id)}"]`);
}

/**
 * Plays the widget's exit (a short fade and settle, `.is-leaving`) and resolves when it is done. With
 * reduced motion the durations are 0, so it resolves on the next frame. An animation that is cut short
 * (the element went away, or the slot re-rendered) still resolves.
 */
export async function playExit(el: HTMLElement): Promise<void> {
  el.classList.add("is-leaving");
  // Running animations exist only after styles are recalculated for the new class.
  const running = el.getAnimations().filter((a) => a instanceof CSSAnimation && a.animationName === "slot-out");
  await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
}

export interface RemoveDeps {
  readonly locked: () => boolean;
  /** The widget's element on screen, if it has one; it animates out before the layout drops it. */
  readonly element: (id: string) => HTMLElement | null;
  readonly exit: (el: HTMLElement) => Promise<void>;
}

const liveRemoveDeps: RemoveDeps = {
  locked: () => getApp().settings.getState().settings.layout.locked,
  element: slotElement,
  exit: playExit,
};

/**
 * Removes a widget the way a person sees it go: it animates out, then the layout drops it as one undoable
 * step, and an undo toast offers it back. The edit is refused (and nothing animates) while locked.
 */
export async function removeWithExit(layout: LayoutStore, id: string, name: string, deps: RemoveDeps = liveRemoveDeps): Promise<boolean> {
  const state = layout.getState();
  if (!state.editing || deps.locked()) return false;
  if (!state.placements.some((p) => p.id === id)) return false;
  const el = deps.element(id);
  if (el) {
    el.inert = true;
    await deps.exit(el);
  }
  const removed = layout.getState().remove(id).ok;
  if (el && !removed) {
    el.classList.remove("is-leaving");
    el.inert = false;
  }
  if (removed) {
    announce(`${name} removed`);
    undoTokens += 1;
    editUi.setState({ undoToast: { message: `${name} removed`, token: undoTokens } });
  }
  return removed;
}

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  /** No icon leaves the icon column empty, so labels stay aligned. */
  readonly icon: IconName | null;
  readonly tone?: "danger";
  /** Set for one-of-many choices (the size presets): true on the current one. */
  readonly checked?: boolean;
  readonly disabled?: boolean;
  /** Draws a hairline above this item, to group the menu. */
  readonly separated?: boolean;
  readonly run: () => void;
}

export interface MenuTarget {
  readonly id: string;
  readonly name: string;
  readonly sizes: readonly SizeSpec[];
  readonly size: string;
  readonly locked: boolean;
  /** The grid cell under the right-click; "Add widget here" lands new widgets there. */
  readonly at: Cell;
}

/**
 * The right-click menu on a widget. Every action opens edit mode first, so the change shows the edit
 * toolbar's Undo and Done and is saved with the rest of the layout; nothing edits behind the user's back.
 */
export function widgetMenuItems(t: MenuTarget, layout: LayoutStore): MenuItem[] {
  const open = (): void => layout.getState().enterEdit(t.id);
  const items: MenuItem[] = [{ id: "edit", label: "Edit home screen", icon: "edit", run: open }];
  if (t.sizes.length > 1) {
    t.sizes.forEach((s, i) =>
      items.push({
        id: `size-${s.id}`,
        label: `${s.name}, ${s.w} by ${s.h}`,
        icon: s.id === t.size ? "check" : null,
        checked: s.id === t.size,
        disabled: t.locked,
        separated: i === 0,
        run: () => {
          open();
          if (s.id !== t.size && layout.getState().resizeTo(t.id, s.id).ok) announce(`${t.name} resized to ${s.w} by ${s.h} cells`);
        },
      }),
    );
  }
  items.push(
    {
      id: "add",
      label: "Add widget here",
      icon: "plus",
      disabled: t.locked,
      separated: true,
      run: () => {
        layout.getState().enterEdit();
        editUi.setState({ drawerOpen: true, drawerTab: "add", addAt: t.at });
      },
    },
    {
      id: "duplicate",
      label: "Duplicate",
      icon: "duplicate",
      disabled: t.locked,
      run: () => {
        open();
        if (layout.getState().duplicate(t.id).ok) announce(`${t.name} duplicated`);
      },
    },
    {
      id: "remove",
      label: "Remove",
      icon: "trash",
      tone: "danger",
      disabled: t.locked,
      run: () => {
        open();
        void removeWithExit(layout, t.id, t.name);
      },
    },
  );
  return items;
}

/** Where a widget of this size added from the gallery should go: centred on the pointed cell, if there is one. */
export function addOrigin(at: Cell | null, size: Pick<SizeSpec, "w" | "h"> | undefined): Cell | undefined {
  return at && size ? centredOrigin(at, size.w, size.h) : undefined;
}

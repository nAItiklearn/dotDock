import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { Guide } from "../lib/layout/guides";
import type { Placement, Rect } from "../lib/model/types";

export type DrawerTab = "add" | "selected";

/**
 * Transient edit-mode state that only the overlay's own components care about: the in-flight drag
 * preview, alignment guides and drawer. Kept apart from the layout store so a pointer frame never
 * re-renders anything but the few slots whose position actually changed.
 */
export interface EditUiState {
  /** Placements that differ from the stored ones while a gesture is in flight, by id. */
  readonly preview: ReadonlyMap<string, Placement> | null;
  /** The widget being dragged or resized, if any. */
  readonly activeId: string | null;
  readonly gesture: "move" | "resize" | null;
  /** Where the dragged widget will land, in cells. */
  readonly ghost: Rect | null;
  readonly guides: readonly Guide[];
  readonly drawerOpen: boolean;
  readonly drawerTab: DrawerTab;
  /** Live-region text for screen readers. */
  readonly announcement: string;
}

const initial: EditUiState = {
  preview: null,
  activeId: null,
  gesture: null,
  ghost: null,
  guides: [],
  drawerOpen: false,
  drawerTab: "add",
  announcement: "",
};

export const editUi = createStore<EditUiState>()(() => initial);

export const useEditUi = <T>(selector: (state: EditUiState) => T): T => useStore(editUi, selector);

export function resetEditUi(): void {
  editUi.setState(initial);
}

export function announce(message: string): void {
  editUi.setState({ announcement: message });
}

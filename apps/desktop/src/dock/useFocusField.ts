import { useEffect, type RefObject } from "react";

/** Marks the field a panel types into first. */
export const FOCUS_FIELD = "data-focus-field";

/**
 * Puts the keyboard in a panel's marked field when it opens and whenever the dock window gets the keyboard back.
 * `autoFocus` alone runs at mount, before Windows hands the dock window the keyboard; the browser then restores
 * focus to the item that was clicked, and typing went nowhere (or, before the window had focus, to the app behind).
 */
export function useFocusField(panel: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const focus = (): void => {
      const root = panel.current;
      const field = root?.querySelector<HTMLElement>(`[${FOCUS_FIELD}]`);
      if (!root || !field || root.contains(document.activeElement)) return;
      field.focus();
    };
    focus();
    // A panel that opens on press mounts before the browser's own mouse-down step, which then focuses the item that
    // was pressed; the release of that same press hands the keyboard back to the field.
    window.addEventListener("pointerup", focus, { once: true });
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("pointerup", focus);
      window.removeEventListener("focus", focus);
    };
  }, [panel]);
}

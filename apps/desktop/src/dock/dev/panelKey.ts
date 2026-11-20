/**
 * DEV ONLY. The fixture panel starts hidden, so the dock is seen and tried on its own: right-click menu, edit mode and
 * the settings popover. The backquote key (the key left of 1, no modifier, not while typing) shows or hides the panel;
 * `?panel=1` in the page address opens the harness with the panel already shown.
 */
export const PANEL_KEY = "Backquote";

export const panelShownAtStart = (search: string): boolean => new URLSearchParams(search).get("panel") === "1";

interface KeyLike {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  /** True while the key goes into a text field, where a backquote is a character. */
  readonly typing: boolean;
}

export const togglesPanel = (key: KeyLike): boolean => key.code === PANEL_KEY && !key.ctrlKey && !key.altKey && !key.metaKey && !key.typing;

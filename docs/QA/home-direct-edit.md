# QA: direct editing on the home screen

Owner request (2026-11-21): move, resize and delete widgets directly from the home screen, test it, and make
adding fast and moving smooth. Code: `apps/desktop/src/overlay/`. Decisions: `docs/DECISIONS.md` (this track).

## 1. Audit of `main` at 1b135f3 (before this track)

Read from the code and the core, without Settings. "Edit mode" means the overlay's layout editor.

| Can the user, without Settings... | Today | Gap |
|---|---|---|
| (a) move a widget | Only after right-clicking a widget (enters edit mode), then dragging it | A press and hold or a drag on the widget itself does nothing; there is no hint that right-click is the way in |
| (b) resize it | Only in edit mode, with the corner handle | No handle on hover outside edit mode |
| (c) delete it | Only in edit mode, with the trash button or the Delete key | No right-click menu, no undo toast, the widget vanishes in one frame with no exit animation |
| (d) add one | Only in edit mode: toolbar, Widgets, Add | It lands at the first free cell, not where the user pointed; no enter animation |

Real-desktop findings (the core, `src-tauri/src`):
- **Edit mode never got the keyboard.** The overlay called `overlay_edit_mode`, which the core does not
  implement, so the call failed in the background. The overlay window is non-activating, so Esc, Ctrl+Z,
  Delete and the arrow keys did nothing on the real desktop; they only worked in a browser. The photo widget
  and text fields each called `overlay_set_typing` on their own, so a text field losing focus also dropped
  focus that another part still needed.
- **Right-click on empty desktop goes to Explorer.** Empty space is click-through (D-010), so the overlay never
  sees it. Adding an item to Explorer's desktop menu needs a shell verb under `HKCU\Software\Classes`, which is
  outside the registry keys this project may touch (MASTER_SPEC 1.1). "Add widget" therefore lives in the
  overlay's own menu on a widget, and in the edit toolbar.
- **Click-through must hold everywhere except widgets** (lead, after an incident where a dotDock window
  blocked the whole desktop). The only full-screen hit area is the drag shield, which exists only while a
  pointer is pressed during a gesture.

## 2. Fixes (this track)

Filled in as each piece lands; numbers come from traces, not estimates.

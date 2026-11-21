import { useEffect } from "react";
import { getApp } from "../../lib/state/app";
import { useLayoutStore } from "../../lib/state/hooks";
import { Button } from "../../lib/ui/controls";
import { editUi, useEditUi } from "../editUi";

/** How long the "removed" toast offers its undo; Ctrl+Z and the toolbar keep working after it goes. */
export const UNDO_TOAST_MS = 6000;

/** "Clock removed · Undo", above the edit toolbar after a widget is removed. */
export function UndoToast() {
  const toast = useEditUi((s) => s.undoToast);
  const canUndo = useLayoutStore((s) => s.canUndo);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => editUi.setState({ undoToast: null }), UNDO_TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast || !canUndo) return null;
  return (
    <div className="undo-toast" data-hit role="status">
      <span className="undo-toast__text">{toast.message}</span>
      <Button
        icon="undo"
        onClick={() => {
          getApp().layout.getState().undo();
          editUi.setState({ undoToast: null, announcement: "Removal undone" });
        }}
      >
        Undo
      </Button>
    </div>
  );
}

import { useEffect } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { Button } from "../../lib/ui/controls";

/** How long the "Undo" offer stays. Long enough to read and react, short enough not to linger. */
const UNDO_WINDOW_MS = 9000;

interface UndoItem {
  readonly id: number;
  readonly message: string;
  readonly undo: () => void | Promise<void>;
}

const undoStore = createStore<{ readonly item: UndoItem | null }>()(() => ({ item: null }));
let counter = 0;

/** Offers to take back a destructive action. A newer offer replaces an older one. */
export function offerUndo(message: string, undo: () => void | Promise<void>): void {
  counter += 1;
  undoStore.setState({ item: { id: counter, message, undo } });
}

function dismiss(): void {
  undoStore.setState({ item: null });
}

export function UndoBar() {
  const item = useStore(undoStore, (s) => s.item);
  useEffect(() => {
    if (!item) return undefined;
    const timer = setTimeout(dismiss, UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [item]);
  if (!item) return null;
  return (
    <div className="undo-bar" role="status" aria-live="polite">
      <span className="undo-bar__text">{item.message}</span>
      <Button
        variant="primary"
        onClick={() => {
          dismiss();
          void item.undo();
        }}
      >
        Undo
      </Button>
    </div>
  );
}

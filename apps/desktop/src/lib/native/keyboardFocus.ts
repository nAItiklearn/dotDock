import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../providers/bridge";

/**
 * Why the overlay needs keyboard input right now. The overlay never activates on its own (it must not
 * steal focus from apps); each reason below asks for it, and the core keeps focus while any one holds.
 */
export type KeyboardReason = "typing" | "editing" | "file-dialog" | "menu";

type Sender = (wanted: boolean) => void;

const sendToCore: Sender = (wanted) => {
  if (!isTauri()) return;
  // `overlay_set_typing` lets the window activate, takes the foreground and pushes it back to the bottom.
  invoke("overlay_set_typing", { typing: wanted }).catch((err: unknown) => console.error("overlay_set_typing failed", err));
};

/** Tracks every holder and tells the core only when the union changes, so holders never undo each other. */
export function createKeyboardArbiter(send: Sender) {
  const holders = new Set<KeyboardReason>();
  let wanted = false;
  return {
    hold(reason: KeyboardReason, on: boolean): void {
      if (on) holders.add(reason);
      else holders.delete(reason);
      const next = holders.size > 0;
      if (next === wanted) return;
      wanted = next;
      send(next);
    },
    get wanted(): boolean {
      return wanted;
    },
  };
}

const arbiter = createKeyboardArbiter(sendToCore);

/** Asks for (or releases) keyboard focus for one reason. Safe to call repeatedly and outside the desktop app. */
export function holdKeyboard(reason: KeyboardReason, on: boolean): void {
  arbiter.hold(reason, on);
}

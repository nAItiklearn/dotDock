import { isTauri } from "../providers/bridge";
import { holdKeyboard } from "../lib/native/keyboardFocus";

/** Elements that need keyboard input: the overlay may take focus only while one is focused. */
function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !["checkbox", "radio", "button", "range"].includes(el.type);
}

/**
 * The desktop overlay normally never activates (it must not steal focus from apps), so text
 * fields in widgets could not receive keys. This tells the core when typing starts and ends.
 */
export function syncTypingFocus(): () => void {
  if (!isTauri()) return () => undefined;
  let typing = false;
  const set = (next: boolean): void => {
    if (next === typing) return;
    typing = next;
    holdKeyboard("typing", next);
  };
  const onIn = (e: FocusEvent): void => set(isTextField(e.target));
  // relatedTarget is where focus goes next; null means it left the overlay entirely.
  const onOut = (e: FocusEvent): void => set(isTextField(e.relatedTarget));
  document.addEventListener("focusin", onIn);
  document.addEventListener("focusout", onOut);
  return () => {
    document.removeEventListener("focusin", onIn);
    document.removeEventListener("focusout", onOut);
    set(false);
  };
}

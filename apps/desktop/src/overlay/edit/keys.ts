/**
 * Whether a key event is `letter`: the physical key, so shortcuts work on any keyboard layout, or the typed letter
 * when the input carries no key code (remote desktop, on-screen and scripted keyboards send none).
 */
export function isKey(e: Pick<KeyboardEvent, "code" | "key">, letter: string): boolean {
  return e.code === `Key${letter.toUpperCase()}` || (e.code === "" && e.key.toLowerCase() === letter);
}

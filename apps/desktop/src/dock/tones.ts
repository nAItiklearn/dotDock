import type { CategoryTone } from "./protocol";

/** CSS colour for a category tone. The `--tone-*` values live in dock.css, one set per light and dark theme. */
export function toneVar(tone: CategoryTone): string {
  return tone === "accent" ? "var(--accent)" : `var(--tone-${tone})`;
}

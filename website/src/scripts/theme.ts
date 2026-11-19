/**
 * Theme switching. The first paint is already themed by the inline script in the layout; this
 * wires the controls (nav switch and theme cards), persists the choice, and reveals the new
 * theme with a circular View Transition from the clicked control when the browser supports it.
 */
import { THEMES, THEME_STORAGE_KEY, isThemeId, type ThemeId } from "../lib/themes";
import { prefersReducedMotion } from "../lib/dom";

const root = document.documentElement;
const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-theme-set]")];
const metaColour = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
const REVEAL_MS = 700;

function current(): ThemeId {
  const id = root.dataset["theme"];
  return isThemeId(id) ? id : "obsidian";
}

function sync(): void {
  const active = current();
  for (const b of buttons) {
    const on = b.dataset["themeSet"] === active;
    b.setAttribute("aria-checked", String(on));
    b.tabIndex = on ? 0 : -1;
    const card = b.closest<HTMLElement>(".theme-card");
    if (card) card.classList.toggle("is-active", on);
    const label = card?.querySelector<HTMLElement>("[data-state-label]");
    if (label) label.textContent = on ? "Active" : (label.dataset["mode"] ?? "");
  }
  const theme = THEMES.find((t) => t.id === active);
  if (theme && metaColour) metaColour.setAttribute("content", theme.colors.bg);
}

function commit(id: ThemeId): void {
  root.dataset["theme"] = id;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // Private mode: the theme still applies for this visit.
  }
  sync();
}

function apply(id: ThemeId, origin: { x: number; y: number }): void {
  if (id === current()) return;
  if (!document.startViewTransition || prefersReducedMotion()) {
    commit(id);
    return;
  }
  const radius = Math.hypot(
    Math.max(origin.x, window.innerWidth - origin.x),
    Math.max(origin.y, window.innerHeight - origin.y),
  );
  const transition = document.startViewTransition(() => commit(id));
  transition.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${radius}px at ${origin.x}px ${origin.y}px)`] },
        { duration: REVEAL_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => {
      // The transition was skipped (for example by a second click); the theme is already committed.
    });
}

for (const b of buttons) {
  b.addEventListener("click", () => {
    const id = b.dataset["themeSet"];
    if (!isThemeId(id)) return;
    const r = b.getBoundingClientRect();
    apply(id, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  });
}

/** Arrow keys move through a radio group and select, as the radio pattern expects. */
for (const group of document.querySelectorAll<HTMLElement>('[role="radiogroup"]')) {
  const radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"][data-theme-set]')];
  if (radios.length === 0) continue;
  group.addEventListener("keydown", (e) => {
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!forward && !back) return;
    const at = radios.findIndex((r) => r === document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    const next = radios[(at + (forward ? 1 : radios.length - 1)) % radios.length];
    next?.focus();
    next?.click();
  });
}

sync();

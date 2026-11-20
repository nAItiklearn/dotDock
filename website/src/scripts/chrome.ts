/** Page chrome: the sticky nav state, section reveals and copy-to-clipboard buttons. */
import { requireEl } from "../lib/dom";

const STUCK_AFTER_PX = 8;
const COPIED_MS = 1600;

function initNav(): void {
  const nav = requireEl<HTMLElement>(document, "[data-nav]");
  const update = (): void => {
    nav.classList.toggle("is-stuck", window.scrollY > STUCK_AFTER_PX);
  };
  window.addEventListener("scroll", update, { passive: true });
  update();
}

/** Scenes and the footer meadow fetch their masks when they come within a screen or so of the viewport. */
function initArt(): void {
  const pieces = [...document.querySelectorAll<HTMLElement>("[data-art-lazy]")];
  if (!("IntersectionObserver" in window)) {
    for (const el of pieces) el.classList.add("art--on");
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("art--on");
        io.unobserve(entry.target);
      }
    },
    { rootMargin: "900px 0px" },
  );
  for (const el of pieces) io.observe(el);
}

/** The small-screen menu closes when a link in it is followed, or on Escape. */
function initMenu(): void {
  const menu = document.querySelector<HTMLDetailsElement>("[data-nav-menu]");
  if (!menu) return;
  menu.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest("a")) menu.open = false;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") menu.open = false;
  });
}

function initReveal(): void {
  const items = [...document.querySelectorAll<HTMLElement>(".reveal")];
  if (!("IntersectionObserver" in window)) {
    for (const el of items) el.classList.add("is-in");
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
  );
  for (const el of items) io.observe(el);
}

function initCopy(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    const label = button.textContent ?? "Copy";
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset["copy"] ?? "");
        button.textContent = "Copied";
      } catch {
        button.textContent = "Press Ctrl+C";
        const code = button.parentElement?.querySelector("code");
        if (code) window.getSelection()?.selectAllChildren(code);
      }
      window.setTimeout(() => {
        button.textContent = label;
      }, COPIED_MS);
    });
  }
}

/** Opens the FAQ answer that the URL fragment points at, so links like /faq#restore land open. */
function initFaqLinks(): void {
  const open = (): void => {
    const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    if (target instanceof HTMLDetailsElement) {
      target.open = true;
      target.scrollIntoView();
    }
  };
  open();
  window.addEventListener("hashchange", open);
}

/** The dark gallery keeps a dark palette: the current theme if it is dark, otherwise Obsidian. */
function initWall(): void {
  const wall = document.querySelector<HTMLElement>("[data-wall]");
  if (!wall) return;
  const sync = (): void => {
    wall.dataset["theme"] = document.documentElement.dataset["theme"] === "aurum" ? "aurum" : "obsidian";
  };
  sync();
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  if (!("IntersectionObserver" in window)) return;
  new IntersectionObserver((entries) => {
    for (const entry of entries) wall.classList.toggle("is-live", entry.isIntersecting);
  }).observe(wall);
}

initNav();
initReveal();
initCopy();
initMenu();
initArt();
initFaqLinks();
initWall();

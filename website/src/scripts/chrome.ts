/** Page chrome: the sticky nav state, section reveals and copy-to-clipboard buttons. */
import { requireEl } from "../lib/dom";
import "./visits";

const STUCK_AFTER_PX = 8;
const COPIED_MS = 1600;

/**
 * The nav firms up once the page has scrolled. A marker at the top of the page is watched instead of reading
 * `scrollY` on every scroll event: that read forces a layout in the middle of a frame, which showed in traces
 * as a stall while flicking down the page.
 */
function initNav(): void {
  const nav = requireEl<HTMLElement>(document, "[data-nav]");
  const marker = document.createElement("div");
  marker.setAttribute("aria-hidden", "true");
  marker.style.cssText = `position:absolute;top:0;left:0;width:1px;height:${STUCK_AFTER_PX}px;pointer-events:none`;
  document.body.prepend(marker);
  new IntersectionObserver(([entry]) => {
    if (entry) nav.classList.toggle("is-stuck", !entry.isIntersecting);
  }).observe(marker);
}

/** The screen is laid out at this width on wide pages (see styles/desk.css); a smaller preview scales it down. */
const SCREEN_NATIVE_PX = 1180;
const WIDE_PAGE = "(min-width: 960px)";

function initScaled(): void {
  const boxes = [...document.querySelectorAll<HTMLElement>("[data-scaled]")];
  const wide = window.matchMedia(WIDE_PAGE);
  const fit = (box: HTMLElement): void => {
    const inner = box.querySelector<HTMLElement>("[data-scaled-inner]");
    if (!inner) return;
    if (!wide.matches) {
      box.style.height = "";
      inner.style.cssText = "";
      return;
    }
    const scale = Math.min(1, box.clientWidth / SCREEN_NATIVE_PX);
    inner.style.width = `${SCREEN_NATIVE_PX}px`;
    inner.style.transform = `scale(${scale})`;
    box.style.height = `${inner.offsetHeight * scale}px`;
  };
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) fit(entry.target as HTMLElement);
  });
  for (const box of boxes) {
    ro.observe(box);
    fit(box);
  }
  wide.addEventListener("change", () => boxes.forEach(fit));
}

/** How far ahead of the viewport a piece of art starts to load and decode: a couple of screens, so a fast flick
 * down the page finds every mask decoded before it arrives. */
const ART_AHEAD = "2000px 0px";
const MASK_URL = /url\("?([^")]+)"?\)/g;

/**
 * The masks a piece paints with, as its current rules resolve them (the narrow or wide render, at this screen's
 * pixel ratio). The browser would decode a mask on the main thread the first time it paints it, which shows as a
 * stall while scrolling; decoding them here first, asynchronously, takes that work off the scroll.
 */
function decodeMasks(piece: Element): void {
  const urls = new Set<string>();
  for (const layer of piece.querySelectorAll(".art__layer")) {
    const cs = getComputedStyle(layer);
    const image = cs.getPropertyValue("mask-image") || cs.getPropertyValue("-webkit-mask-image");
    for (const m of image.matchAll(MASK_URL)) if (m[1]) urls.add(m[1]);
  }
  for (const src of urls) {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    img.decode().catch(() => {
      // A mask that fails to load leaves its layer empty; nothing to recover.
    });
  }
}

/** Scenes and the footer meadow fetch and decode their masks when they come within a couple of screens. */
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
        decodeMasks(entry.target);
        io.unobserve(entry.target);
      }
    },
    { rootMargin: ART_AHEAD },
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

/**
 * A link like /#widgets jumps before the fonts and pictures above the target have their final size, so the
 * heading can end up under the sticky nav. Once everything has loaded, land on the target again (no animation).
 */
function initHashLanding(): void {
  const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
  if (!target || target instanceof HTMLDetailsElement) return;
  const land = (): void => target.scrollIntoView({ block: "start", behavior: "instant" });
  void document.fonts.ready.then(land);
  window.addEventListener("load", land, { once: true });
}

initNav();
initReveal();
initCopy();
initMenu();
initArt();
initScaled();
initFaqLinks();
initWall();
initHashLanding();

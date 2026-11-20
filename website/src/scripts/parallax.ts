/**
 * Depth on scroll: pieces of art that carry `data-parallax="f"` drift against the page by the
 * fraction `f` of the scroll distance (positive: lags behind, so it reads as far away; negative:
 * runs ahead, so it reads as near). Only `transform` changes, once per frame, and only while the
 * piece's section is on screen. Off for reduced motion and on narrow screens, where the art is
 * cropped to the middle and a drift would reveal its edge.
 *
 * `data-parallax-origin="page"` measures from the top of the page (the hero); otherwise the
 * offset is zero when the piece's parent is centred in the viewport.
 */
import { prefersReducedMotion } from "../lib/dom";

const WIDE = window.matchMedia("(min-width: 900px)");
const items = [...document.querySelectorAll<HTMLElement>("[data-parallax]")].map((el) => ({
  el,
  parent: el.parentElement ?? el,
  factor: Number(el.dataset["parallax"]),
  fromPage: el.dataset["parallaxOrigin"] === "page",
  visible: false,
}));

let frame = 0;

function paint(): void {
  frame = 0;
  if (!active()) {
    reset();
    return;
  }
  const mid = window.innerHeight / 2;
  for (const item of items) {
    if (!item.visible) continue;
    const dy = item.fromPage ? window.scrollY : mid - (item.parent.getBoundingClientRect().top + item.parent.offsetHeight / 2);
    item.el.style.transform = `translate3d(0, ${(dy * item.factor).toFixed(1)}px, 0)`;
  }
}

function request(): void {
  if (!frame) frame = requestAnimationFrame(paint);
}

function active(): boolean {
  return WIDE.matches && !prefersReducedMotion();
}

let started = false;

function start(): void {
  if (started || items.length === 0 || !("IntersectionObserver" in window)) return;
  started = true;
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const item = items.find((i) => i.parent === entry.target);
      if (item) item.visible = entry.isIntersecting;
    }
    request();
  });
  for (const item of items) io.observe(item.parent);
  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", request, { passive: true });
}

function reset(): void {
  for (const item of items) item.el.style.transform = "";
}

if (active()) start();
for (const query of [WIDE, window.matchMedia("(prefers-reduced-motion: reduce)")]) {
  query.addEventListener("change", () => {
    if (active()) start();
    request();
  });
}

/**
 * The island carousel (components/IslandCarousel.astro): dots follow the scroll and jump to a slide, and the
 * play button starts or stops the slow advance. The advance runs only while the carousel is on screen and not
 * hovered or focused, and never starts for people who prefer reduced motion. No timer runs while it is hidden.
 */
import { ADVANCE_MS, nearestSlide, nextSlide, shouldAdvance } from "../lib/carousel";

const reduced = matchMedia("(prefers-reduced-motion: reduce)");

for (const root of document.querySelectorAll<HTMLElement>("[data-carousel]")) {
  const track = root.querySelector<HTMLElement>("[data-carousel-track]");
  const play = root.querySelector<HTMLButtonElement>("[data-carousel-play]");
  const playLabel = root.querySelector<HTMLElement>("[data-carousel-play-label]");
  const dots = [...root.querySelectorAll<HTMLButtonElement>("[data-carousel-dot]")];
  if (!track || !play || !playLabel) continue;
  const slides = [...track.children] as HTMLElement[];
  const state = { playing: !reduced.matches, visible: false, hovered: false, focused: false };
  let current = 0;
  let timer: number | undefined;

  const offsets = (): number[] => slides.map((s) => s.offsetLeft - (slides[0]?.offsetLeft ?? 0));
  const show = (index: number): void => {
    track.scrollTo({ left: offsets()[index] ?? 0, behavior: reduced.matches ? "auto" : "smooth" });
  };
  const mark = (index: number): void => {
    current = index;
    dots.forEach((d, i) => (i === index ? d.setAttribute("aria-current", "true") : d.removeAttribute("aria-current")));
  };
  const sync = (): void => {
    window.clearInterval(timer);
    timer = undefined;
    if (shouldAdvance(state)) timer = window.setInterval(() => show(nextSlide(current, slides.length)), ADVANCE_MS);
    play.setAttribute("aria-pressed", String(state.playing));
    playLabel.textContent = state.playing ? "Pause" : "Play";
  };

  play.hidden = false;
  play.addEventListener("click", () => {
    state.playing = !state.playing;
    sync();
  });
  dots.forEach((d, i) => d.addEventListener("click", () => show(i)));
  let frame = 0;
  track.addEventListener("scroll", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => mark(nearestSlide(track.scrollLeft, offsets())));
  }, { passive: true });
  root.addEventListener("pointerenter", () => ((state.hovered = true), sync()));
  root.addEventListener("pointerleave", () => ((state.hovered = false), sync()));
  root.addEventListener("focusin", () => ((state.focused = true), sync()));
  root.addEventListener("focusout", (e) => {
    if (!root.contains(e.relatedTarget as Node | null)) ((state.focused = false), sync());
  });
  new IntersectionObserver(([entry]) => {
    state.visible = entry?.isIntersecting ?? false;
    sync();
  }).observe(root);
  sync();
}

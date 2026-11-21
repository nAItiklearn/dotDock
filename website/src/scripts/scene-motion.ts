/**
 * Living scenes (components/LiveScene.astro) move only while they are on screen: an IntersectionObserver puts
 * `live--paused` on a scene that scrolls out of view, which pauses every animation inside it (styles/live.css).
 * No timers, no polling; under reduced motion nothing moves, so no observer is created.
 */
const STILL = window.matchMedia("(prefers-reduced-motion: reduce)");

if (!STILL.matches) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.target.classList.toggle("live--paused", !entry.isIntersecting);
  });
  for (const scene of document.querySelectorAll<HTMLElement>("[data-live]")) observer.observe(scene);
}

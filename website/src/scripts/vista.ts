/**
 * The download page's meadow moves only while it is on screen: an IntersectionObserver pauses every
 * animation inside it (styles/download.css, `.vista--paused`) when it scrolls out of view. No timers, no
 * polling; under reduced motion there is nothing to pause and the observer is not created.
 */
const QUIET = window.matchMedia("(prefers-reduced-motion: reduce)");

for (const vista of document.querySelectorAll<HTMLElement>("[data-vista]")) {
  if (QUIET.matches) continue;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) vista.classList.toggle("vista--paused", !entry.isIntersecting);
  });
  observer.observe(vista);
}

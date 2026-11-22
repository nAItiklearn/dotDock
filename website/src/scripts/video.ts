/**
 * Recordings of the app (components/VideoSlot.astro): each plays muted and looped only while it is on screen, and
 * nothing is downloaded before it first comes into view. A video with a loop window plays its logo sting once, then
 * loops only the footage, so it never ends on black. With reduced motion nothing plays by itself: the poster
 * stays, with the player's controls to start it.
 */
import { loopedTime, loopWindow } from "../lib/videoLoop";

const VISIBLE_SHARE = 0.35;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Jumps back to the start of the footage when the closing card begins, checked on every frame where possible. */
function loopFootage(video: HTMLVideoElement): void {
  const span = loopWindow(video.dataset.loopStart, video.dataset.loopEnd);
  if (!span) return;
  const check = (): void => {
    const next = loopedTime(video.currentTime, span);
    if (next !== video.currentTime) video.currentTime = next;
  };
  // Every current browser has requestVideoFrameCallback; timeupdate (a few times a second) is the fallback.
  if (typeof (video as Partial<HTMLVideoElement>).requestVideoFrameCallback === "function") {
    const onFrame = (): void => {
      check();
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  } else {
    (video as HTMLVideoElement).addEventListener("timeupdate", check);
  }
}

function initVideos(): void {
  const videos = [...document.querySelectorAll<HTMLVideoElement>("video[data-autoplay]")];
  if (videos.length === 0) return;
  if (window.matchMedia(REDUCED_MOTION).matches) {
    for (const video of videos) video.controls = true;
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) {
          if (video.preload === "none") video.preload = "auto";
          // A browser that refuses autoplay leaves the poster; the controls let the visitor start it.
          video.play().catch(() => {
            video.controls = true;
          });
        } else {
          video.pause();
        }
      }
    },
    { threshold: VISIBLE_SHARE },
  );
  for (const video of videos) {
    loopFootage(video);
    observer.observe(video);
  }
}

initVideos();

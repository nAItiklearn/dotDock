// Records the gap between consecutive animation frames until frames-read.js collects it.
(() => {
  const gaps = [];
  let last = performance.now();
  let live = true;
  const tick = (now) => {
    gaps.push(now - last);
    last = now;
    if (live) requestAnimationFrame(tick);
  };
  requestAnimationFrame((now) => { last = now; requestAnimationFrame(tick); });
  window.__dockFrames = { gaps, stop: () => { live = false; } };
  return "recording";
})();

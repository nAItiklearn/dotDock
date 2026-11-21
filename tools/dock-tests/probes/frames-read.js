// Stops the recording and summarises it. A frame counts as dropped when its gap is longer than 1.5 refresh periods.
(() => {
  const rec = window.__dockFrames;
  if (!rec) return null;
  rec.stop();
  const gaps = rec.gaps.slice().sort((a, b) => a - b);
  const pick = (q) => gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] ?? 0;
  const period = pick(0.5);
  const dropped = rec.gaps.filter((g) => g > period * 1.5).length;
  const total = rec.gaps.reduce((a, b) => a + b, 0);
  return { frames: gaps.length, fps: +(1000 * gaps.length / total).toFixed(1), p50: +period.toFixed(2), p95: +pick(0.95).toFixed(2), max: +(gaps.at(-1) ?? 0).toFixed(2), dropped };
})();

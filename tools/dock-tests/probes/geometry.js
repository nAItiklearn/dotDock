// Measures the bar: every cell's box, the gaps between neighbours, the running dots and the pill, in device pixels.
(() => {
  const dpr = devicePixelRatio;
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: +(r.x * dpr).toFixed(3), y: +(r.y * dpr).toFixed(3), w: +(r.width * dpr).toFixed(3), h: +(r.height * dpr).toFixed(3) }; };
  const cells = [...document.querySelectorAll(".dock__row > *")].map(box);
  const gaps = cells.slice(1).map((c, i) => +(c.x - (cells[i].x + cells[i].w)).toFixed(3));
  const dots = [...document.querySelectorAll(".dock [class*='dot']")].map(box);
  const dock = document.querySelector(".dock");
  return {
    dpr,
    theme: document.querySelector(".dock-root")?.getAttribute("data-dock-theme"),
    bar: dock ? box(dock) : null,
    cells: cells.length,
    sizes: [...new Set(cells.map((c) => `${c.w}x${c.h}`))],
    gaps: [...new Set(gaps)],
    tops: [...new Set(cells.map((c) => c.y))],
    dots: dots.length,
    dotSizes: [...new Set(dots.map((d) => `${d.w}x${d.h}`))],
    fractional: cells.filter((c) => !Number.isInteger(c.x) || !Number.isInteger(c.y)).length,
  };
})();

async () => {
  // Layout check, run in a browser tab on the site's origin (see "Layout check" in README.md).
  // Loads each page at each width in an iframe and reports: sideways overflow, text that touches art,
  // text clipped by its box, widgets that overlap each other or leave their screen.
  // Open http://127.0.0.1:4330/robots.txt?paths=/,/features and run this file with the devtools evaluate_script tool.
  const paths = (new URLSearchParams(location.search).get("paths") || "/").split(",");
  const widths = (new URLSearchParams(location.search).get("widths") || "390,414,768,1024,1280,1440").split(",").map(Number);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const problems = [];
  const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const BY_DESIGN = ".desk, .scene, .dock, .stage, [data-wall], .nav, noscript, .theme-switch";

  for (const path of paths) {
    for (const w of widths) {
      const frame = document.createElement("iframe");
      frame.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:900px;border:0;opacity:0;pointer-events:none`;
      document.body.appendChild(frame);
      await new Promise((resolve) => {
        frame.onload = resolve;
        frame.src = path;
      });
      await sleep(500);
      const d = frame.contentDocument;
      d.querySelectorAll(".reveal").forEach((e) => e.classList.add("is-in"));
      d.querySelectorAll("[data-art-lazy]").forEach((e) => e.classList.add("art--on"));
      await sleep(300);
      const where = `${path} @${w}`;
      const add = (kind, detail) => problems.push(`${where}: ${kind}: ${detail}`);

      if (d.documentElement.scrollWidth > w + 1) add("sideways overflow", `${d.documentElement.scrollWidth}px wide`);

      const arts = [...d.querySelectorAll(".art")].map((e) => ({ el: e, r: e.getBoundingClientRect() }));
      const walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent.trim();
        const parent = node.parentElement;
        if (!text || !parent || parent.closest(BY_DESIGN) || parent.closest("script,style,[hidden],.sr-only")) continue;
        // The answer of a closed disclosure is not on screen.
        const shut = parent.closest("details:not([open])");
        // Text in a box that scrolls sideways (code, wide tables) is reached by scrolling that box.
        if (parent.closest("pre,.table-wrap,.code__text")) continue;
        if (shut && !parent.closest("summary")) continue;
        const range = d.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width < 2 || r.height < 2) continue;
          if (r.right > w + 1 || r.left < -1) add("text outside the page", text.slice(0, 40));
          for (const a of arts) {
            if (area(r, a.r) > 16 && !seen.has(text + a.el.className)) {
              seen.add(text + a.el.className);
              add("text over art", `"${text.slice(0, 40)}" over ${a.el.className}`);
            }
          }
        }
      }

      for (const el of d.querySelectorAll("h1,h2,h3,p,li,a,button,span,td,th,summary")) {
        if (el.closest("noscript,[hidden],.sr-only") || el.children.length > 0) continue;
        const cs = d.defaultView.getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== "visible" && el.clientWidth > 0 && cs.textOverflow !== "ellipsis") {
          add("clipped text", `"${(el.textContent || "").trim().slice(0, 40)}" ${el.scrollWidth}>${el.clientWidth}`);
        }
      }

      for (const stage of d.querySelectorAll(".stage")) {
        const sr = stage.getBoundingClientRect();
        if (sr.width < 1) continue;
        const cards = [...stage.querySelectorAll(".w")].map((e) => ({ e, r: e.getBoundingClientRect() })).filter((c) => c.r.width > 1);
        for (let i = 0; i < cards.length; i++) {
          const a = cards[i];
          if (a.r.left < sr.left - 1 || a.r.right > sr.right + 1 || a.r.top < sr.top - 1 || a.r.bottom > sr.bottom + 1) add("widget leaves its screen", a.e.getAttribute("aria-label") || a.e.className);
          for (let j = i + 1; j < cards.length; j++) if (area(a.r, cards[j].r) > 9) add("widgets overlap", `${a.e.getAttribute("aria-label")} / ${cards[j].e.getAttribute("aria-label")}`);
        }
        const island = stage.querySelector(".desk__island");
        if (island) {
          const ir = island.getBoundingClientRect();
          for (const c of cards) if (area(ir, c.r) > 9) add("widget under the island", c.e.getAttribute("aria-label") || c.e.className);
          const dock = stage.querySelector(".desk__dock");
          const dr = dock && dock.getBoundingClientRect();
          if (dr) for (const c of cards) if (area(dr, c.r) > 9) add("widget under the dock", c.e.getAttribute("aria-label") || c.e.className);
          if (dr && (dr.left < sr.left - 1 || dr.right > sr.right + 1)) add("dock leaves its screen", `${Math.round(dr.width)}px in ${Math.round(sr.width)}px`);
        }
      }
      frame.remove();
    }
  }
  // Group the same finding across widths so one cause reads as one line.
  const grouped = new Map();
  for (const p of problems) {
    const at = p.indexOf(" @");
    const colon = p.indexOf(": ", at);
    const key = `${p.slice(0, at)} ${p.slice(colon + 2).replace(/\s+/g, " ")}`;
    grouped.set(key, [...(grouped.get(key) || []), p.slice(at + 2, colon)]);
  }
  return { pages: paths, widths, count: problems.length, problems: [...grouped].map(([k, w]) => `${k} @${w.join(",")}`).slice(0, 80) };
}

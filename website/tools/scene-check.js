async () => {
  // Scene check, run in a browser tab on the site's origin (tools/scene-qa.mjs runs it on every page and width).
  // Loads each page at each width in an iframe and fails when a pixel scene (.live, the living scenes, or .vista,
  // the download meadow) touches any text, button, link, image, video or form control, when a scene box leaves
  // the viewport, or when the page scrolls sideways. A scene is its own band, so the answer must always be none.
  //   open <origin>/robots.txt?paths=/,/features,/privacy,/download and evaluate this file.
  const query = new URLSearchParams(location.search);
  const paths = (query.get("paths") || "/").split(",");
  const widths = (query.get("widths") || "390,414,768,1024,1280,1440").split(",").map(Number);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SCENES = ".live, .vista";
  const SOLID = "button, a, img, video, picture, svg, input, select, textarea, iframe, canvas, .btn, .widget, .desk, .dock";
  const meets = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
  const problems = [];
  let scenes = 0;

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

      const boxes = [...d.querySelectorAll(SCENES)].map((el) => ({ el, r: el.getBoundingClientRect() }));
      scenes += boxes.length;
      for (const { el, r } of boxes) {
        if (r.left < -0.5 || r.right > w + 0.5) add("scene leaves the viewport", `${el.className} spans ${Math.round(r.left)} to ${Math.round(r.right)}`);
      }
      const inScene = (node) => node.closest(SCENES);
      // A colour layer with no mask paints its whole box: a render that lacks that colour must hide it.
      for (const layer of d.querySelectorAll(`:is(${SCENES}) .art__layer`)) {
        const cs = d.defaultView.getComputedStyle(layer);
        const mask = cs.maskImage || cs.webkitMaskImage;
        if (cs.display !== "none" && (!mask || mask === "none")) add("art layer without a mask", `${layer.closest(".art").className} ${layer.className}`);
      }

      // Every line of visible text.
      const walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        const text = node.textContent.trim();
        if (!text || !parent || inScene(parent) || parent.closest("script,style,noscript,[hidden],.sr-only")) continue;
        if (parent.closest("details:not([open])") && !parent.closest("summary")) continue;
        const range = d.createRange();
        range.selectNodeContents(node);
        for (const t of range.getClientRects()) {
          if (t.width < 1 || t.height < 1) continue;
          for (const { el, r } of boxes) if (meets(t, r)) add("text meets a scene", `"${text.slice(0, 40)}" and ${el.className}`);
        }
      }
      // Every button, link, picture and control.
      for (const el of d.querySelectorAll(SOLID)) {
        if (inScene(el) || el.closest("noscript,[hidden]")) continue;
        const t = el.getBoundingClientRect();
        if (t.width < 1 || t.height < 1) continue;
        for (const { el: s, r } of boxes) if (meets(t, r)) add("element meets a scene", `${el.tagName.toLowerCase()}.${el.className} and ${s.className}`);
      }
      frame.remove();
    }
  }
  return { paths, widths, scenes, count: problems.length, problems: [...new Set(problems)] };
}

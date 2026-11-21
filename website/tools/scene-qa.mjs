// Living-scene QA in a Chrome window kept off screen (tools/cdp.mjs): the scene check (tools/scene-check.js) on every page at every width,
// screenshots of each scene and of each page with one, the reduced-motion still, and frame times while a scene
// moves and while the page scrolls past it, on desktop and on a phone width with the CPU slowed four times.
// Serve the built site first (node tools/preview.mjs 4361), then:
//   node tools/scene-qa.mjs http://127.0.0.1:4361 ../docs/QA/website-art-live [check|shots|perf|all]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./cdp-offscreen.mjs";

const [base, outDir, mode = "all"] = process.argv.slice(2);
if (!base || !outDir) throw new Error("usage: scene-qa.mjs <base url> <out dir> [check|shots|perf|all]");
const WIDTHS = [390, 414, 768, 1024, 1280, 1440];
const PAGES = ["/", "/features", "/privacy", "/download", "/changelog"];
const SCENE_PAGES = { paddock: "/", pond: "/features", reef: "/privacy", meadow: "/changelog" };
const THEMES = ["paper", "obsidian", "aurum"];
const PHONE_CPU_SLOWDOWN = 4;
mkdirSync(outDir, { recursive: true });

const b = await launch(9352, 900);
const report = [];
const toScene = (sel) =>
  b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); scrollTo({ top: Math.round(el.getBoundingClientRect().top + scrollY - (innerHeight - el.offsetHeight) / 2), behavior: 'instant' }); return true; })()`);

if (mode === "check" || mode === "all") {
  await b.viewport(1440);
  await b.open(`${base}/robots.txt?paths=${PAGES.join(",")}&widths=${WIDTHS.join(",")}`);
  const result = await b.evaluate(`(${readFileSync(join(import.meta.dirname, "scene-check.js"), "utf8")})()`);
  report.push(`scene check ${PAGES.join(" ")} at ${WIDTHS.join(", ")}: ${result.scenes} scene boxes, ${result.count} problems ${JSON.stringify(result.problems)}`);
}

if (mode === "shots" || mode === "all") {
  for (const [scene, path] of Object.entries(SCENE_PAGES)) {
    for (const w of WIDTHS) {
      await b.viewport(w);
      await b.open(`${base}${path}`);
      await b.showAll();
      await toScene(`.live--${scene}`);
      await sleep(900);
      await b.shot(join(outDir, `${scene}-${w}-paper.png`), false);
    }
    await b.viewport(1440);
    for (const t of THEMES.slice(1)) {
      await b.theme(t);
      await toScene(`.live--${scene}`);
      await sleep(700);
      await b.shot(join(outDir, `${scene}-1440-${t}.png`), false);
    }
    await b.theme("paper");
    for (const w of [390, 1440]) {
      await b.viewport(w);
      await b.open(`${base}${path}`);
      await b.showAll();
      await b.shot(join(outDir, `page-${scene}-${w}.png`));
    }
  }
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await b.viewport(1440);
  await b.open(`${base}/privacy`);
  await b.showAll();
  await toScene(".live--reef");
  report.push(`reduced motion: running animations in the scene = ${await b.evaluate("document.querySelector('.live').getAnimations({ subtree: true }).length")}`);
  await b.shot(join(outDir, "reef-1440-reduced-motion.png"), false);
  await b.send("Emulation.setEmulatedMedia", { features: [] });
}

if (mode === "perf" || mode === "all") {
  for (const [scene, path] of Object.entries(SCENE_PAGES)) {
    for (const [w, slow] of [[1440, 1], [390, PHONE_CPU_SLOWDOWN]]) {
      await b.viewport(w);
      await b.open(`${base}${path}`);
      await b.send("Emulation.setCPUThrottlingRate", { rate: slow });
      await toScene(`.live--${scene}`);
      await sleep(1500);
      const first = await b.frames(6000, 0, ".live");
      const steady = await b.frames(6000, 0, ".live");
      await b.evaluate(`scrollTo({ top: document.querySelector('.live--${scene}').getBoundingClientRect().top + scrollY - innerHeight, behavior: 'instant' })`);
      await sleep(600);
      const scroll = await b.frames(3000, 6, ".live");
      await b.evaluate("scrollTo({ top: 0, behavior: 'instant' })");
      await sleep(600);
      const paused = await b.evaluate(`document.querySelector('.live--${scene}').classList.contains('live--paused')`);
      report.push(`${scene} @${w} cpu x${slow}: first 6 s in view (masks decoding) ${JSON.stringify(first)}; next 6 s ${JSON.stringify(steady)}; scrolling past ${JSON.stringify(scroll)}; paused off screen ${paused}`);
      await b.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    }
  }
}

console.log(report.join("\n"));
writeFileSync(join(outDir, `report-${mode}.txt`), `${report.join("\n")}\n`);
b.close();

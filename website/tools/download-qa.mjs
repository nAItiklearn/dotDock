// Download page QA in a Chrome window kept off screen (tools/cdp.mjs): screenshots at every width and theme, the
// meadow close up, the reduced-motion still, the layout check (tools/layout-check.js) and frame times while the
// meadow moves. Serve the built site first (node tools/preview.mjs 4361), then:
//   node tools/download-qa.mjs http://127.0.0.1:4361 ../docs/QA/download-live [shots|layout|perf|all]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./cdp-offscreen.mjs";

const [base, outDir, mode = "all"] = process.argv.slice(2);
if (!base || !outDir) throw new Error("usage: download-qa.mjs <base url> <out dir> [shots|layout|perf|all]");
const WIDTHS = [390, 414, 768, 1024, 1280, 1440];
const THEMES = ["paper", "obsidian", "aurum"];
mkdirSync(outDir, { recursive: true });

const b = await launch(9351, 900);
const report = [];
const toVista = async (offset) => {
  const y = await b.evaluate("document.querySelector('.vista').getBoundingClientRect().top + scrollY");
  await b.evaluate(`scrollTo({ top: ${Math.round(y) - offset}, behavior: 'instant' })`);
};

if (mode === "shots" || mode === "all") {
  for (const w of WIDTHS) {
    await b.viewport(w);
    await b.open(`${base}/download`);
    for (const t of THEMES) {
      await b.theme(t);
      await b.showAll();
      await b.shot(join(outDir, `download-${w}-${t}.png`));
    }
  }
  // The meadow at a desktop width, close up, in each theme: only the picture.
  await b.viewport(1440);
  await b.open(`${base}/download`);
  for (const t of THEMES) {
    await b.theme(t);
    await toVista(60);
    await sleep(700);
    await b.shot(join(outDir, `vista-1440-${t}.png`), false);
  }
  // Reduced motion: the still.
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await b.theme("paper");
  await b.open(`${base}/download`);
  report.push(`reduced motion: running animations in the meadow = ${await b.evaluate("document.querySelector('.vista').getAnimations({ subtree: true }).length")}`);
  await b.showAll();
  await b.shot(join(outDir, "download-1440-paper-reduced-motion.png"));
  await b.send("Emulation.setEmulatedMedia", { features: [] });
}

if (mode === "layout" || mode === "all") {
  await b.viewport(1440);
  await b.open(`${base}/robots.txt?paths=/download`);
  const problems = await b.evaluate(`(${readFileSync(join(import.meta.dirname, "layout-check.js"), "utf8")})()`);
  report.push(`layout check /download at ${WIDTHS.join(", ")}: ${JSON.stringify(problems)}`);
}

if (mode === "perf" || mode === "all") {
  for (const w of [390, 1440]) {
    await b.viewport(w);
    await b.open(`${base}/download`);
    await toVista(80);
    await sleep(800);
    report.push(`frames @${w}: ${JSON.stringify(await b.frames(6000, 0, ".vista"))}`);
    // Off screen the meadow is paused.
    await b.evaluate("scrollTo({ top: document.body.scrollHeight, behavior: 'instant' })");
    await sleep(600);
    report.push(`paused off screen @${w}: ${await b.evaluate("document.querySelector('.vista').classList.contains('vista--paused')")}`);
  }
}

console.log(report.join("\n"));
writeFileSync(join(outDir, `report-${mode}.txt`), `${report.join("\n")}\n`);
b.close();

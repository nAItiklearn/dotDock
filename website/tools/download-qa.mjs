// Download page QA in a visible Chrome window over CDP: screenshots at every width and theme, the release and
// reduced-motion states, the layout check (tools/layout-check.js) and frame times while the meadow moves.
// Serve the built site first (node tools/preview.mjs 4361), then:
//   node tools/download-qa.mjs http://127.0.0.1:4361 ../docs/QA/download-live [shots|layout|perf|all]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [base, outDir, mode = "all"] = process.argv.slice(2);
if (!base || !outDir) throw new Error("usage: download-qa.mjs <base url> <out dir> [shots|layout|perf|all]");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9351;
const WIDTHS = [390, 414, 768, 1024, 1280, 1440];
const HEIGHT = 900;
const THEMES = ["paper", "obsidian", "aurum"];
const FRAME_BUDGET_MS = 1000 / 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "dl-qa-"));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--window-size=1500,1000", "about:blank"], { stdio: "ignore" });

let ws;
let seq = 0;
const pending = new Map();
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener("open", r));
        ws.addEventListener("message", (ev) => {
          const msg = JSON.parse(ev.data);
          if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
          }
        });
        return;
      }
    } catch {
      /* Chrome is still starting */
    }
    await sleep(200);
  }
  throw new Error("Chrome did not open its debugging port");
}
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result))));
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
  return r.result.value;
}
async function viewport(width, height = HEIGHT) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 900 });
}
async function open(url) {
  await send("Page.navigate", { url });
  await sleep(1400);
  await evaluate("document.fonts.ready.then(() => true)");
}
async function theme(id) {
  await evaluate(`(() => { localStorage.setItem('dotdock-theme', '${id}'); document.documentElement.dataset.theme = '${id}'; return true; })()`);
  await sleep(300);
}
async function shot(file, full = true) {
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
  writeFileSync(join(outDir, file), Buffer.from(data, "base64"));
  console.log("shot", file);
}
async function showAll() {
  await evaluate("(() => { document.querySelectorAll('.reveal').forEach((e) => e.classList.add('is-in')); return true; })()");
  await sleep(500);
}

await connect();
await send("Page.enable");
const report = [];

if (mode === "shots" || mode === "all") {
  for (const w of WIDTHS) {
    await viewport(w);
    await open(`${base}/download`);
    for (const t of THEMES) {
      await theme(t);
      await showAll();
      await shot(`download-${w}-${t}.png`);
    }
  }
  // The meadow at a desktop width, close up, in each theme: only the picture.
  await viewport(1440);
  await open(`${base}/download`);
  for (const t of THEMES) {
    await theme(t);
    const y = await evaluate("document.querySelector('.vista').getBoundingClientRect().top + scrollY");
    await evaluate(`scrollTo(0, ${Math.round(y) - 60})`);
    await sleep(700);
    await shot(`vista-1440-${t}.png`, false);
  }
  await evaluate("scrollTo(0, 0)");
  // Reduced motion: the still.
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await theme("paper");
  await open(`${base}/download`);
  report.push(`reduced motion: running animations in the meadow = ${await evaluate("document.querySelector('.vista').getAnimations({ subtree: true }).length")}`);
  await shot("download-1440-paper-reduced-motion.png");
  await send("Emulation.setEmulatedMedia", { features: [] });
}

if (mode === "layout" || mode === "all") {
  await viewport(1440);
  await open(`${base}/robots.txt?paths=/download`);
  const check = readFileSync(join(import.meta.dirname, "layout-check.js"), "utf8");
  const problems = await evaluate(`(${check})()`);
  report.push(`layout check /download at ${WIDTHS.join(", ")}: ${JSON.stringify(problems)}`);
}

if (mode === "perf" || mode === "all") {
  for (const w of [390, 1440]) {
    await viewport(w);
    await open(`${base}/download`);
    const y = await evaluate("document.querySelector('.vista').getBoundingClientRect().top + scrollY");
    await evaluate(`scrollTo(0, ${Math.round(y) - 80})`);
    await sleep(800);
    const stats = await evaluate(`new Promise((resolve) => {
      const deltas = []; let last = performance.now(); const end = last + 6000;
      const tick = (t) => { deltas.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else {
        const sorted = [...deltas].sort((a, b) => a - b);
        resolve({ frames: deltas.length, mean: +(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(2),
          p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2), max: +sorted[sorted.length - 1].toFixed(2),
          dropped: deltas.filter((d) => d > ${FRAME_BUDGET_MS} * 1.5).length,
          animations: document.querySelector('.vista').getAnimations({ subtree: true }).length });
      } };
      requestAnimationFrame(tick);
    })`);
    report.push(`frames @${w}: ${JSON.stringify(stats)}`);
    // Off screen the meadow is paused.
    await evaluate("scrollTo(0, document.body.scrollHeight)");
    await sleep(600);
    report.push(`paused off screen @${w}: ${await evaluate("document.querySelector('.vista').classList.contains('vista--paused')")}`);
  }
}

console.log(report.join("\n"));
writeFileSync(join(outDir, `report-${mode}.txt`), `${report.join("\n")}\n`);
ws.close();
chrome.kill();

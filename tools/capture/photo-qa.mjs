// Photo widget QA: captures the widget gallery over desktop wallpapers and measures frame times
// while photos are swapped and the widget is resized, in headless Chrome over CDP.
// Run from the repository root. Usage: node tools/capture/photo-qa.mjs <gallery base url> <output dir> [shots|perf]
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [base, outDir, mode = "shots"] = process.argv.slice(2);
if (!base || !outDir) throw new Error("usage: photo-qa.mjs <gallery url> <out dir> [shots|perf]");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
const VIEWPORT = { width: 1800, height: 1100, deviceScaleFactor: 1.5 };
const WALLPAPERS = [
  "meadow-dots-dark", "meadow-dots-light", "halftone-ridge-dark", "paper-ring-light",
  "red-waves-dark", "glass-orbs-light", "topo-lines-dark",
];
// Full-size originals from this repository's art engine (3840 x 2160), served by Vite's /@fs/.
const ART = `/@fs/${process.cwd().replaceAll("\\", "/")}/assets/wallpapers`;
const PHOTO = `${ART}/bloom-dots-light.jpg`;
const BENCH_PHOTOS = ["bloom-dots-light", "flute-flower-dark", "halftone-ridge-light", "glass-orbs-dark"].map((n) => `${ART}/${n}.jpg`);
const SIZE_GROUPS = { compact: "s,medium,tall", wide: "m,landscape,xl", large: "l,panorama" };

mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "photo-qa-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--hide-scrollbars", "--force-color-profile=srgb", "about:blank",
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* Chrome is still starting */ }
    await sleep(200);
  }
  throw new Error("Chrome did not open a debugging port");
}

const ws = new WebSocket(await connect());
await new Promise((r) => ws.addEventListener("open", r));
let nextId = 0;
const waiting = new Map();
const events = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  else if (msg.method) events.push(msg);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

async function open(url) {
  events.length = 0;
  await send("Page.navigate", { url });
  for (let i = 0; i < 100 && !events.some((e) => e.method === "Page.loadEventFired"); i++) await sleep(100);
  await evaluate(`new Promise((r) => { const t = () => document.querySelector(".gallery") ? setTimeout(r, 800) : setTimeout(t, 50); t(); })`);
}

async function shot(file) {
  const { width, height } = await evaluate(`({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })`);
  const { data } = await send("Page.captureScreenshot", {
    format: "png", captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  writeFileSync(join(outDir, file), Buffer.from(data, "base64"));
  console.log(file, `${width}x${height}`);
}

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, mobile: false });

if (mode === "shots") {
  for (const wp of WALLPAPERS) {
    for (const [group, sizes] of Object.entries(SIZE_GROUPS)) {
      await open(`${base}?only=photo&sizes=${sizes}&photo=${PHOTO}&wallpaper=${ART}/${wp}.jpg`);
      await shot(`${wp}-${group}.png`);
    }
  }
  for (const theme of ["obsidian", "paper"]) {
    await open(`${base}?only=photo&sizes=medium&panel=1&theme=${theme}&photo=${PHOTO}&wallpaper=${ART}/meadow-dots-${theme === "paper" ? "light" : "dark"}.jpg`);
    await shot(`panel-${theme}.png`);
  }
} else {
  // Frame times: every frame's interval over a run that swaps photos and resizes the widgets.
  await open(`${base}?perf=${BENCH_PHOTOS.join(",")}&wallpaper=${ART}/meadow-dots-dark.jpg`);
  const result = await evaluate(`(${perfRun.toString()})()`);
  writeFileSync(join(outDir, "perf.json"), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
}

ws.close();
chrome.kill();

/** Runs in the page. Records frame intervals while swapping photos and resizing every widget. */
function perfRun() {
  const stats = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
    return { frames: s.length, median: +at(0.5).toFixed(1), p95: +at(0.95).toFixed(1), p99: +at(0.99).toFixed(1), max: +s[s.length - 1].toFixed(1), over20ms: s.filter((x) => x > 20).length };
  };
  const record = (ms, step) =>
    new Promise((resolve) => {
      const gaps = [];
      let last = performance.now();
      const start = last;
      let n = 0;
      const tick = (now) => {
        gaps.push(now - last);
        last = now;
        step(n++);
        if (now - start < ms) requestAnimationFrame(tick);
        else resolve(stats(gaps.slice(2)));
      };
      requestAnimationFrame(tick);
    });
  // Long animation frames, with where the time went: scripts, then style/layout/paint.
  const loafs = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      loafs.push({
        at: Math.round(e.startTime), ms: Math.round(e.duration), blockingMs: Math.round(e.blockingDuration),
        scriptMs: Math.round(e.scripts.reduce((t, s) => t + s.duration, 0)),
        styleLayoutMs: Math.round(e.startTime + e.duration - e.styleAndLayoutStart),
        scripts: e.scripts.map((s) => `${s.invoker} ${Math.round(s.duration)}ms`).slice(0, 4),
      });
    }
  }).observe({ type: "long-animation-frame" });
  if (!window.__photoQa) return { error: "the gallery has no __photoQa hook" };
  return window.__photoQa(record).then((runs) => ({ ...runs, longFrames: loafs }));
}

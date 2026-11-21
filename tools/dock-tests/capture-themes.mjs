// Screenshots of the dock in each theme over the Wind Meadow wallpaper, in headless Chrome.
//
//   node tools/dock-tests/capture-themes.mjs http://localhost:1530/dock.html <out-dir> [glass,obsidian,...] [--dpr=1]
//
// Needs `vite dev` running for apps/desktop. Writes <theme>.png (the bottom band of the screen, where the dock is).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9334;
const VIEWPORT = { width: 1600, height: 900 };
/** The band captured: the dock, its shadow and enough wallpaper around it to judge the frosting. */
const BAND = 220;
const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:1530/dock.html";
const outDir = args.find((a) => !a.startsWith("http") && !a.startsWith("--") && !a.includes(",") && !/^[a-z-]+$/.test(a)) ?? "docs/QA/dock-themes";
const list = args.find((a) => /^[a-z,-]+$/.test(a) && !a.startsWith("http"));
const themes = (list ?? "glass,glass-lite,obsidian,paper,aurum,minimal").split(",");
const dpr = Number(args.find((a) => a.startsWith("--dpr="))?.slice(6) ?? "1");

mkdirSync(outDir, { recursive: true });
const profile = join(process.env.LOCALAPPDATA ?? tmpdir(), "dockDock", "capture-chrome");
mkdirSync(profile, { recursive: true });
const chrome = spawn(CHROME, [`--headless=new`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" });
      return await res.json();
    } catch {
      await sleep(200);
    }
  }
  throw new Error("headless Chrome did not start");
}

function session(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    }
  };
  const ready = new Promise((r) => (ws.onopen = r));
  const send = async (method, params = {}) => {
    await ready;
    id += 1;
    const msg = await new Promise((resolve) => {
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
    return msg.result;
  };
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

let failed = 0;
try {
  const t = await target();
  const s = session(t.webSocketDebuggerUrl);
  await s.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: dpr, mobile: false });
  for (const theme of themes) {
    await s.send("Page.navigate", { url: `${url}?sample=1&panel=0&wall=meadow-dots-dark&dock-theme=${theme}` });
    await s.evaluate(`new Promise((resolve, reject) => { const t0 = Date.now(); const poll = () => window.dockDev?.store.getState().ready ? resolve(true) : Date.now() - t0 > 15000 ? reject(new Error("dock never became ready")) : setTimeout(poll, 100); poll(); })`);
    await s.evaluate(`new Promise((r) => setTimeout(r, 1200))`);
    const drawn = await s.evaluate(`document.querySelector('.dock-root')?.getAttribute('data-dock-theme')`);
    if (drawn !== theme) {
      console.error(`${theme}: the dock drew ${drawn}`);
      failed += 1;
    }
    const shot = await s.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: VIEWPORT.height - BAND, width: VIEWPORT.width, height: BAND, scale: 1 } });
    writeFileSync(join(outDir, `${theme}.png`), Buffer.from(shot.data, "base64"));
    console.log(`${theme} -> ${join(outDir, `${theme}.png`)} (drawn as ${drawn})`);
  }
  s.close();
} catch (err) {
  console.error(String(err));
  failed += 1;
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);

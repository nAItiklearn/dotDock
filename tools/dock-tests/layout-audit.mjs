// Pixel and frame audit of the dock harness, in headless Chrome, at 100 %, 125 % and 150 % scaling.
//
//   node tools/dock-tests/layout-audit.mjs http://localhost:1530/dock.html [--perf] [--dpr=1,1.25,1.5]
//
// Needs `vite dev` running for apps/desktop. Nothing is shown on screen. Exits 1 when any check fails, so it can
// gate a commit. Uses Chrome's DevTools protocol over the WebSocket that Node has built in.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
const VIEWPORT = { width: 1600, height: 900 };
const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:1530/dock.html";
const wantPerf = args.includes("--perf");
const dprs = (args.find((a) => a.startsWith("--dpr="))?.slice(6) ?? "1,1.25,1.5").split(",").map(Number);
const tiles = ["flip", "sun", "wind", "currency", "memo"];

const profile = join(process.env.LOCALAPPDATA ?? tmpdir(), "dockDock", "audit-chrome");
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
const report = [];
try {
  const t = await target();
  const s = session(t.webSocketDebuggerUrl);
  for (const dpr of dprs) {
    await s.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: dpr, mobile: false });
    await s.send("Page.navigate", { url: `${url}?sample=1` });
    await s.evaluate(`new Promise((resolve, reject) => { const t0 = Date.now(); const poll = () => window.dockDev?.store.getState().ready ? resolve(true) : Date.now() - t0 > 15000 ? reject(new Error("dock never became ready")) : setTimeout(poll, 100); poll(); })`);
    await s.evaluate(`window.dockDev.actions.updateSettings({ tiles: ${JSON.stringify(tiles)} }).then(() => new Promise((r) => setTimeout(r, 600)))`);
    for (const magnification of [1]) {
      await s.evaluate(`window.dockDev.actions.updateSettings({ magnification: ${magnification} }).then(() => new Promise((r) => setTimeout(r, 300)))`);
      const result = await s.evaluate(`window.dockDev.audit()`);
      failed += result.findings.length;
      report.push({ dpr, magnification, measured: result.measured, findings: result.findings });
    }
    if (wantPerf && dpr === 1) {
      await s.evaluate(`window.dockDev.actions.updateSettings({ magnification: 1.25 })`);
      const sweep = await s.evaluate(`window.dockDev.perf.frames(5000)`);
      const work = await s.evaluate(`window.dockDev.perf.work(300)`);
      const first = await s.evaluate(`document.querySelector('[data-key^="app:"]')?.getAttribute('data-key')`);
      const drag = first ? await s.evaluate(`window.dockDev.perf.drag(${JSON.stringify(first)}, 3000)`) : null;
      const stack = await s.evaluate(`(() => { const k = document.querySelector('[data-key^="stack:"]')?.getAttribute('data-key'); return k ? window.dockDev.perf.opens(k, 20) : null; })()`);
      report.push({ perf: { sweep, work, drag, stack } });
    }
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
console.log(JSON.stringify(report, null, 2));
process.exit(failed === 0 ? 0 : 1);

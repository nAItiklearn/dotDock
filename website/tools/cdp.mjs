// A Chrome window, kept off screen, driven over the DevTools protocol, for the QA scripts (scene-qa.mjs): open pages at a
// width, set the theme, reveal everything, take screenshots, evaluate scripts and read frame times.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
// The harness window stays off the owner's screen; occlusion tracking is off so an unseen window still renders
// every frame (otherwise frame times would be meaningless).
const OFF_SCREEN = ["--window-position=-4000,-4000", "--disable-features=CalculateNativeWinOcclusion", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"];
export const FRAME_BUDGET_MS = 1000 / 60;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(port, height) {
  const profile = mkdtempSync(join(tmpdir(), "site-qa-"));
  const chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--window-size=1500,1000", ...OFF_SCREEN, "about:blank"], { stdio: "ignore" });
  let ws;
  let seq = 0;
  const pending = new Map();
  for (let i = 0; i < 100 && !ws; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener("open", r));
      }
    } catch {
      /* Chrome is still starting */
    }
    if (!ws) await sleep(200);
  }
  if (!ws) throw new Error("Chrome did not open its debugging port");
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}) => {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result))));
  };
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
    return r.result.value;
  };
  await send("Page.enable");
  return {
    send,
    evaluate,
    async viewport(width) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 900 });
    },
    async open(url) {
      await send("Page.navigate", { url });
      await sleep(1400);
      await evaluate("document.fonts.ready.then(() => true)");
    },
    async theme(id) {
      await evaluate(`(() => { localStorage.setItem('dotdock-theme', '${id}'); document.documentElement.dataset.theme = '${id}'; return true; })()`);
      await sleep(300);
    },
    // The footer skips rendering until it nears the viewport (content-visibility: auto), which a full-page capture
    // never does; render it, the revealed sections and the lazy art, so the page is captured as a reader sees it.
    async showAll() {
      await evaluate("(() => { document.querySelectorAll('.reveal').forEach((e) => e.classList.add('is-in')); document.querySelectorAll('[data-art-lazy]').forEach((e) => e.classList.add('art--on')); const f = document.querySelector('.footer'); if (f) f.style.contentVisibility = 'visible'; return true; })()");
      await sleep(600);
    },
    async shot(file, full = true) {
      const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
      writeFileSync(file, Buffer.from(data, "base64"));
      console.log("shot", file);
    },
    // Frame times over `ms`, scrolling `scrollPx` per frame when given (a reader flicking down the page), and how
    // many animations run inside the elements matching `within`.
    frames(ms, scrollPx, within) {
      return evaluate(`new Promise((resolve) => {
        const deltas = []; let last = performance.now(); const end = last + ${ms};
        const tick = (t) => { deltas.push(t - last); last = t; if (${scrollPx}) scrollBy(0, ${scrollPx}); if (t < end) requestAnimationFrame(tick); else {
          const sorted = [...deltas].sort((a, b) => a - b);
          resolve({ frames: deltas.length, mean: +(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(2),
            p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2), max: +sorted[sorted.length - 1].toFixed(2),
            dropped: deltas.filter((d) => d > ${FRAME_BUDGET_MS} * 1.5).length,
            animations: [...document.querySelectorAll(${JSON.stringify(within)})].reduce((n, e) => n + e.getAnimations({ subtree: true }).length, 0) });
        } };
        requestAnimationFrame(tick);
      })`);
    },
    close() {
      ws.close();
      chrome.kill();
    },
  };
}

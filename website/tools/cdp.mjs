// A tiny Chrome DevTools Protocol client (no dependencies) for the dock captures (tools/capture-dock.mjs).
// It starts a headless Chrome with its own profile under .cache, opens one page and drives it.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = Number(process.env.CDP_PORT ?? 9471), profile }) {
  mkdirSync(profile, { recursive: true });
  // Never drive someone else's browser or app webview: the port must be free before our Chrome takes it.
  const taken = await fetch(`http://127.0.0.1:${port}/json/version`).then(() => true).catch(() => false);
  if (taken) throw new Error(`Port ${port} already has a DevTools endpoint; pick another with CDP_PORT.`);
  const proc = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--headless=new", "--hide-scrollbars", "--force-color-profile=srgb", "--no-first-run", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 150 && !targets?.some((t) => t.type === "page"); i++) {
    await sleep(200);
    targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => undefined);
  }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  const waiters = [];
  /** Errors the page logs, for the capture script to report. */
  const logs = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`));
      else resolve(msg.result);
    } else if (msg.method) {
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") logs.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
      if (msg.method === "Runtime.exceptionThrown") logs.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
      for (const w of waiters.splice(0)) if (w.method === msg.method) w.resolve(msg.params); else waiters.push(w);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const myId = ++id;
      pending.set(myId, { resolve, reject });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  const once = (method) => new Promise((resolve) => waiters.push({ method, resolve }));
  await send("Page.enable");
  await send("Runtime.enable");

  const api = {
    send,
    logs,
    async viewport(width, height, scale = 2) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
    },
    async goto(url, settle = 1500) {
      const loaded = once("Page.loadEventFired");
      await send("Page.navigate", { url });
      await loaded;
      await sleep(settle);
    },
    async eval(expression) {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`${expression.slice(0, 80)}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    },
    async mouse(type, x, y, button = "none", clickCount = 0) {
      await send("Input.dispatchMouseEvent", { type, x, y, button, clickCount, buttons: button === "left" ? 1 : button === "right" ? 2 : 0 });
    },
    async move(x, y, steps = 8) {
      for (let i = 1; i <= steps; i++) {
        await api.mouse("mouseMoved", x - (steps - i) * 4, y);
        await sleep(16);
      }
    },
    async click(x, y, button = "left") {
      await api.move(x, y, 3);
      await api.mouse("mousePressed", x, y, button, 1);
      await api.mouse("mouseReleased", x, y, button, 1);
    },
    async key(code, key) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", code, key });
      await send("Input.dispatchKeyEvent", { type: "keyUp", code, key });
    },
    async shot(clip) {
      const r = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}), captureBeyondViewport: false });
      return Buffer.from(r.data, "base64");
    },
    close() {
      ws.close();
      proc.kill();
    },
  };
  return api;
}

export { sleep };
export const profileDir = (root) => join(root, ".cache", "chrome-capture");

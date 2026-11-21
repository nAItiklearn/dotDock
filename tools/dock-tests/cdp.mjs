// Headless Chrome over the DevTools protocol, for the dock's scripted tests. Uses the WebSocket Node has built in.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts a headless Chrome with a throwaway profile under %LOCALAPPDATA%\dockDock; `stop` kills it and deletes the profile. */
export function launch(port, name) {
  const profile = join(process.env.LOCALAPPDATA ?? tmpdir(), "dockDock", name);
  mkdirSync(profile, { recursive: true });
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  const stop = async () => {
    chrome.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  };
  return { stop };
}

/** A new tab in the Chrome listening on `port`, retried while it starts. */
export async function target(port) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
      return await res.json();
    } catch {
      await sleep(200);
    }
  }
  throw new Error("headless Chrome did not start");
}

/** A protocol session on one tab. `onEvent` receives every event message (method and params). */
export function session(wsUrl, onEvent = () => {}) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method) onEvent(msg);
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

/** Resolves once the dock harness has its first snapshot. */
export const DOCK_READY = `new Promise((resolve, reject) => { const t0 = Date.now(); const poll = () => window.dockDev?.store.getState().ready ? resolve(true) : Date.now() - t0 > 15000 ? reject(new Error("dock never became ready")) : setTimeout(poll, 100); poll(); })`;

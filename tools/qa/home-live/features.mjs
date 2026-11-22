// Home screen V1 live run, feature by feature, with the real cursor on the real desktop overlay.
// Each feature: what the overlay reports (DevTools protocol), what window is under the cursor, a screenshot,
// pass or fail. Then the wallpaper is changed several times and the widget colours are checked against the
// theme each wallpaper gives (palettes.mjs). Writes features.json and per-feature screenshots to <out>.
// Start the app with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>: every webview in the
// process shares one browser, so a port on one window alone stops the others from being created.
// Usage: node features.mjs <devtools-port> <out-dir> <palettes.json> <wallpaper-dir>
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [port, out, palettesFile, wallpaperDir] = process.argv.slice(2);
const palettes = JSON.parse(readFileSync(palettesFile, "utf8"));
const desk = (...args) =>
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(import.meta.dirname, "desk.ps1"), ...args.map(String)], {
    encoding: "utf8",
  }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Human pace between actions. */
const PAUSE_MS = 900;

const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page" && t.url.includes("overlay.html"));
if (!page) throw new Error("overlay page not found on the DevTools port");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});
const evaluate = (expression) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (msg) => (msg.result?.exceptionDetails ? reject(new Error(JSON.stringify(msg.result.exceptionDetails))) : resolve(msg.result?.result?.value)));
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  });

const STATE = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
  const button = (name) => r([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === name || b.getAttribute('aria-label') === name));
  const safe = (side) => parseFloat(getComputedStyle(document.querySelector('.overlay') ?? document.documentElement).getPropertyValue('--safe-' + side)) || 0;
  return {
    dpr: devicePixelRatio, vw: innerWidth, vh: innerHeight,
    work: { top: safe('top'), right: innerWidth - safe('right'), bottom: innerHeight - safe('bottom'), left: safe('left') },
    editing: !!document.querySelector('.overlay--editing'),
    drawer: r(document.querySelector('#edit-drawer')),
    toolbar: r(document.querySelector('.toolbar__panel')),
    toast: r(document.querySelector('.undo-toast')),
    undo: button('Undo'),
    shield: !!document.querySelector('.drag-shield'),
    slots: [...document.querySelectorAll('[data-slot-id]')].map((el) => ({
      id: el.dataset.slotId, rect: r(el), selected: el.classList.contains('is-selected'),
      text: el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 60), notice: !!el.querySelector('.widget-notice'),
      handle: r(el.querySelector('[data-resize-handle]')), remove: r(el.querySelector('.slot-chrome__remove')),
      bg: getComputedStyle(el.querySelector('.surface, [class*=widget]') ?? el).backgroundColor,
    })),
    widgets: button('Widgets'), done: button('Done'),
    firstAdd: r(document.querySelector('.gallery-card button[aria-label^="Add "]')),
    surfaceToken: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),
  };
})()`;
const FRAMES_START = `(() => { const f = []; let last = performance.now(); let on = true;
  const tick = (t) => { f.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
  requestAnimationFrame(tick); window.__qaFrames = { stop: () => { on = false; return f.slice(1); } }; return true; })()`;
const FRAMES_STOP = `(() => { const f = window.__qaFrames.stop(); const s = [...f].sort((a, b) => a - b);
  const p = (x) => +s[Math.floor(x * (s.length - 1))].toFixed(2);
  return { frames: f.length, p50: p(0.5), p95: p(0.95), max: p(1), dropped: f.filter((x) => x > 25).length }; })()`;

const results = [];
const px = (rect, s) => [Math.round((rect.x + rect.w / 2) * s.dpr), Math.round((rect.y + rect.h / 2) * s.dpr)];
async function feature(name, run) {
  const before = await evaluate(STATE);
  let problem = null;
  let data;
  try {
    data = await run(before);
    await sleep(PAUSE_MS);
    problem = data?.problem ?? null;
  } catch (e) {
    problem = String(e.message ?? e);
  }
  const shot = join(out, `f${String(results.length + 1).padStart(2, "0")}-${name}.png`);
  desk("shot", shot);
  results.push({ feature: name, pass: !problem, problem: problem ?? undefined, data, shot });
  console.log(`${problem ? "FAIL" : "pass"} ${name}${problem ? `: ${problem}` : ""}${data?.info ? ` | ${JSON.stringify(data.info)}` : ""}`);
}
const state = () => evaluate(STATE);
const inside = (r, w) => r && r.x >= w.left - 1 && r.y >= w.top - 1 && r.x + r.w <= w.right + 1 && r.y + r.h <= w.bottom + 1;

desk("minimize-all");
await sleep(1500);
const start = await state();
// Widgets with a card: a press between the digits of the bare clock lands on the wallpaper, by design.
const carded = start.slots.filter((x) => x.bg !== "rgba(0, 0, 0, 0)");
if (carded.length < 2) throw new Error("need two widgets with a card on the desktop");
const [a, b] = carded;

await feature("widgets-render-real-data", async (s) => {
  const empty = s.slots.filter((x) => x.text.length === 0 && !x.id.startsWith("photo"));
  const notices = s.slots.filter((x) => x.notice).map((x) => x.id);
  return { info: s.slots.map((x) => `${x.id}: ${x.text}`), problem: empty.length ? `blank: ${empty.map((x) => x.id)}` : notices.length ? `notice shown: ${notices}` : null };
});
await feature("enter-edit-from-menu", async (s) => {
  desk("click", ...px(s.slots.find((x) => x.id === a.id).rect, s), "right");
  await sleep(PAUSE_MS);
  const item = await evaluate(`(() => { const b = [...document.querySelectorAll('[role=menuitem]')].find((x) => x.textContent.includes('Edit'));
    if (!b) return null; const r = b.getBoundingClientRect(); return [Math.round((r.left + r.width / 2) * devicePixelRatio), Math.round((r.top + r.height / 2) * devicePixelRatio)]; })()`);
  if (!item) return { problem: "no Edit item in the widget menu" };
  desk("click", ...item);
  await sleep(1500);
  return { problem: (await state()).editing ? null : "edit mode did not open" };
});
await feature("toolbar-inside-work-area", async (s) => ({ info: { toolbar: s.toolbar, work: s.work }, problem: inside(s.toolbar, s.work) ? null : "toolbar outside the work area" }));
await feature("select-a-then-b", async (s) => {
  desk("click", ...px(s.slots.find((x) => x.id === a.id).rect, s));
  await sleep(PAUSE_MS);
  const one = await state();
  desk("click", ...px(one.slots.find((x) => x.id === b.id).rect, one));
  await sleep(PAUSE_MS);
  const two = await state();
  const sel = two.slots.filter((x) => x.selected).map((x) => x.id);
  return { info: sel, problem: sel.length === 1 && sel[0] === b.id ? null : `selected ${sel}` };
});
await feature("deselect-on-empty-desktop", async (s) => {
  desk("click", Math.round(s.vw * s.dpr * 0.5), Math.round(s.vh * s.dpr * 0.45));
  await sleep(PAUSE_MS);
  const now = await state();
  const sel = now.slots.filter((x) => x.selected).map((x) => x.id);
  return { info: { under: desk("at", Math.round(s.vw * s.dpr * 0.5), Math.round(s.vh * s.dpr * 0.45)), sel }, problem: sel.length ? `still selected: ${sel}` : null };
});
await feature("free-move-drag", async (s) => {
  const was = s.slots.find((x) => x.id === b.id).rect;
  const [x, y] = px(was, s);
  await evaluate(FRAMES_START);
  desk("drag", x, y, x + 150, y + 70, 900);
  const frames = await evaluate(FRAMES_STOP);
  await sleep(PAUSE_MS);
  const now = await state();
  const r = now.slots.find((q) => q.id === b.id).rect;
  const moved = Math.abs(r.x - was.x) > 40;
  return { info: { frames, from: was, to: r }, problem: now.shield ? "drag shield left up" : !moved ? "did not move" : frames.dropped > 0 ? `${frames.dropped} dropped frames` : null };
});
await feature("resize-with-handle", async (s) => {
  desk("click", ...px(s.slots.find((x) => x.id === b.id).rect, s));
  await sleep(PAUSE_MS);
  const sel = await state();
  const slot = sel.slots.find((x) => x.id === b.id);
  if (!slot.handle) return { problem: "no resize handle on the selected widget" };
  const [hx, hy] = px(slot.handle, sel);
  desk("drag", hx, hy, hx + Math.round(90 * sel.dpr), hy + Math.round(90 * sel.dpr), 700);
  await sleep(PAUSE_MS);
  const now = (await state()).slots.find((x) => x.id === b.id).rect;
  return { info: { from: slot.rect, to: now }, problem: now.w * now.h !== slot.rect.w * slot.rect.h ? null : "size did not change (the widget may have one size only)" };
});
await feature("widgets-button-opens-gallery", async (s) => {
  desk("click", ...px(s.widgets, s));
  await sleep(1200);
  const now = await state();
  return { info: { drawer: now.drawer, work: now.work }, problem: !now.drawer ? "+ Widgets did not open the gallery" : inside(now.drawer, now.work) ? null : "drawer outside the work area" };
});
await feature("add-from-gallery", async (s) => {
  if (!s.firstAdd) return { problem: "no Add button in the gallery" };
  desk("click", ...px(s.firstAdd, s));
  await sleep(1200);
  return { problem: (await state()).slots.length === s.slots.length + 1 ? null : "no widget added" };
});
await feature("remove-and-undo-toast", async (s) => {
  const target = s.slots.find((x) => x.id === a.id);
  desk("click", ...px(target.rect, s));
  await sleep(PAUSE_MS);
  const sel = await state();
  const rm = sel.slots.find((x) => x.id === target.id)?.remove;
  if (!rm) return { problem: "no remove button on the selected widget" };
  desk("click", ...px(rm, sel));
  await sleep(PAUSE_MS);
  const gone = await state();
  if (gone.slots.length !== sel.slots.length - 1) return { problem: "widget not removed" };
  if (!gone.toast || !inside(gone.toast, gone.work)) return { problem: "undo toast missing or outside the work area" };
  desk("shot", join(out, "f-remove-toast.png"));
  const undo = await evaluate(`(() => { const b = document.querySelector('.undo-toast button'); if (!b) return null; const r = b.getBoundingClientRect();
    return [Math.round((r.left + r.width / 2) * devicePixelRatio), Math.round((r.top + r.height / 2) * devicePixelRatio)]; })()`);
  desk("click", ...undo);
  await sleep(1200);
  return { problem: (await state()).slots.length === sel.slots.length ? null : "undo did not bring it back" };
});
await feature("done-leaves-edit-and-desktop-clicks-through", async (s) => {
  desk("click", ...px(s.done, s));
  await sleep(1200);
  const now = await state();
  const p = [Math.round(now.vw * now.dpr * 0.5), Math.round(now.vh * now.dpr * 0.45)];
  const under = desk("at", ...p);
  return { info: under, problem: now.editing ? "still editing" : /dotdock/i.test(under) ? `empty desktop covered: ${under}` : null };
});

// Wallpaper changes: the new wallpaper and the theme it gives land together; widgets must follow in one go.
for (const w of palettes) {
  await feature(`wallpaper-${w.file.replace(/\.jpg$/, "")}`, async () => {
    await evaluate(FRAMES_START);
    desk("wallpaper", join(wallpaperDir, w.file));
    await evaluate(`(() => { const c = ${JSON.stringify(w.colors)}; const v = { bg: '--bg', surface: '--surface', surface2: '--surface-2', border: '--border', text: '--text',
      textDim: '--text-dim', accent: '--accent', accentInk: '--accent-ink', dotOn: '--dot-on', dotOff: '--dot-off', danger: '--danger', success: '--success' };
      const root = document.documentElement; for (const k in v) root.style.setProperty(v[k], c[k]); root.style.colorScheme = '${w.mode}'; return true; })()`);
    await sleep(1500);
    const frames = await evaluate(FRAMES_STOP);
    const now = await state();
    const follows = now.surfaceToken.toLowerCase() === w.colors.surface.toLowerCase();
    return { info: { frames, surface: now.surfaceToken, slotBg: now.slots.slice(0, 3).map((x) => x.bg) }, problem: !follows ? "theme tokens did not change" : frames.dropped > 0 ? `${frames.dropped} dropped frames` : null };
  });
}

await sleep(3000);
const idle = desk("cpu", "dotdock", 10000);
results.push({ feature: "idle-cpu", pass: Number(idle.replace(",", "")) < 0.2, data: { percentOfMachine: idle } });
console.log(`idle cpu ${idle}%`);
writeFileSync(join(out, "features.json"), JSON.stringify({ when: new Date().toISOString(), results }, null, 2));
ws.close();
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);

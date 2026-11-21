// The owner's sequence on the real desktop overlay, with a real cursor: enter edit from the widget menu,
// click widget A, click widget B, drag B, + Widgets, add one, Done, then check the empty desktop is not
// covered. After every step it records the overlay's state (DevTools protocol, DOTDOCK_QA_DEVTOOLS_PORT),
// the window under the click point and the overlay's click-through bits, and asserts the outcome.
// Usage: node sequence.mjs <devtools-port> <out-dir>
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const [port = "9333", out = "."] = process.argv.slice(2);
const desk = (...args) =>
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(import.meta.dirname, "desk.ps1"), ...args.map(String)], {
    encoding: "utf8",
  }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.url.includes("overlay.html"));
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
    pending.set(id, (msg) =>
      msg.result?.exceptionDetails ? reject(new Error(JSON.stringify(msg.result.exceptionDetails))) : resolve(msg.result?.result?.value),
    );
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  });

const STATE = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
  const slots = [...document.querySelectorAll('[data-slot-id]')].map((el) => ({ id: el.dataset.slotId, rect: r(el), selected: el.classList.contains('is-selected') }));
  const button = (name) => r([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === name || b.getAttribute('aria-label') === name));
  return {
    dpr: devicePixelRatio,
    editing: !!document.querySelector('.overlay--editing'),
    drawerOpen: !!document.querySelector('#edit-drawer'),
    shield: !!document.querySelector('.drag-shield'),
    focused: document.activeElement?.dataset?.slotId ?? document.activeElement?.tagName ?? null,
    slots,
    widgets: button('Widgets'),
    done: button('Done'),
    firstAdd: r(document.querySelector('.gallery-card button[aria-label^="Add "]')),
  };
})()`;

// Frame timing during a drag, measured in the overlay itself while the real cursor moves.
const FRAMES_START = `(() => { const f = []; let last = performance.now(); let on = true;
  const tick = (t) => { f.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
  requestAnimationFrame(tick); window.__qaFrames = { f, stop: () => { on = false; } }; return true; })()`;
const FRAMES_STOP = `(() => { const q = window.__qaFrames; q.stop(); const f = q.f.slice(1); const s = [...f].sort((a, b) => a - b);
  const p = (x) => +s[Math.floor(x * (s.length - 1))].toFixed(2);
  return { frames: f.length, p50: p(0.5), p95: p(0.95), max: p(1), over25ms: f.filter((x) => x > 25).length }; })()`;

const log = [];
let failures = 0;
const centre = (rect, dpr) => [Math.round((rect.x + rect.w / 2) * dpr), Math.round((rect.y + rect.h / 2) * dpr)];

async function step(name, { point, run, settle = 900 }, expect) {
  const before = await evaluate(STATE);
  const at = point ? point(before) : null;
  const under = at ? desk("at", ...at) : null;
  const extra = run ? await run(at, before) : undefined;
  await sleep(settle);
  const after = await evaluate(STATE);
  const style = desk("style");
  const problem = expect(after, before);
  if (problem) failures++;
  const shot = join(out, `seq-${String(log.length + 1).padStart(2, "0")}-${name}.png`);
  desk("shot", shot);
  log.push({
    step: name,
    point: at,
    windowUnderPoint: under,
    overlayStyle: style,
    ok: !problem,
    problem: problem || undefined,
    extra,
    after: { ...after, slots: after.slots.map((s) => `${s.id}${s.selected ? "*" : ""}@${Math.round(s.rect.x)},${Math.round(s.rect.y)}`) },
  });
  console.log(`${problem ? "FAIL" : "ok  "} ${name}${problem ? `: ${problem}` : ""} | under=${under} | ${style}${extra ? ` | ${JSON.stringify(extra)}` : ""}`);
}

const slotCentre = (id) => (s) => centre(s.slots.find((x) => x.id === id).rect, s.dpr);

desk("minimize-all");
await sleep(1500);
const first = await evaluate(STATE);
const [a, b] = first.slots;
if (!a || !b) throw new Error("need two widgets on the desktop");

await step("right-click-A", { point: slotCentre(a.id), run: async (p) => desk("click", ...p, "right") }, () => null);
await step(
  "menu-edit",
  {
    run: async () => {
      const item = await evaluate(`(() => { const b = [...document.querySelectorAll('[role=menuitem]')].find((x) => x.textContent.includes('Edit'));
        if (!b) return null; const r = b.getBoundingClientRect();
        return [Math.round((r.left + r.width / 2) * devicePixelRatio), Math.round((r.top + r.height / 2) * devicePixelRatio)]; })()`);
      if (item) desk("click", ...item);
      return { menuItemAt: item };
    },
    settle: 1500,
  },
  (s) => (s.editing ? null : "edit mode did not open"),
);
await step("click-A", { point: slotCentre(a.id), run: async (p) => desk("click", ...p) }, (s) =>
  s.slots.find((x) => x.id === a.id)?.selected ? null : "widget A not selected",
);
await step("click-B", { point: slotCentre(b.id), run: async (p) => desk("click", ...p) }, (s) =>
  s.slots.find((x) => x.id === b.id)?.selected ? null : "widget B not selected after A",
);
await step(
  "drag-B",
  {
    point: slotCentre(b.id),
    run: async (p) => {
      await evaluate(FRAMES_START);
      desk("drag", p[0], p[1], p[0] + 140, p[1] + 90, 900);
      return evaluate(FRAMES_STOP);
    },
    settle: 1200,
  },
  (s, before) => {
    const was = before.slots.find((x) => x.id === b.id).rect;
    const now = s.slots.find((x) => x.id === b.id).rect;
    if (s.shield) return "drag shield still up after release";
    return Math.abs(now.x - was.x) > 40 ? null : "widget B did not move";
  },
);
await step("widgets-button", { point: (s) => centre(s.widgets, s.dpr), run: async (p) => desk("click", ...p) }, (s) =>
  s.drawerOpen ? null : "+ Widgets did not open the gallery",
);
await step("add-first", { point: (s) => (s.firstAdd ? centre(s.firstAdd, s.dpr) : null), run: async (p) => p && desk("click", ...p), settle: 1200 }, (s, before) =>
  s.slots.length === before.slots.length + 1 ? null : "no widget added",
);
await step("done", { point: (s) => centre(s.done, s.dpr), run: async (p) => desk("click", ...p), settle: 1200 }, (s) =>
  s.editing ? "Done did not leave edit mode" : null,
);
await step("empty-desktop-is-click-through", { point: () => [1700, 950], settle: 300 }, () => {
  const under = desk("at", 1700, 950);
  return under.includes("dotdock") ? `empty desktop is covered by the overlay (${under})` : null;
});

writeFileSync(join(out, "sequence-result.json"), JSON.stringify({ when: new Date().toISOString(), failures, log }, null, 2));
ws.close();
console.log(failures === 0 ? "PASS" : `FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

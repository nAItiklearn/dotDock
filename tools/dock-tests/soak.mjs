// Random-input soak of the dock harness in headless Chrome: thousands of real mouse and key events (moves, hovers,
// clicks, double, right and middle clicks, drags, wheel, Escape) aimed mostly at the dock and its open panels. Fails
// on any uncaught error or console error, a dock that stops drawing, or a stuck state: after every burst, Escape and a
// click on the empty desktop must leave no panel, menu or drag behind.
//
//   node tools/dock-tests/soak.mjs http://localhost:1530/dock.html [--events=5000] [--seed=1] [--dpr=1]
//
// Needs `vite dev` running for apps/desktop. The same seed replays the same run. Prints a JSON summary; exits 1 on failure.
import { DOCK_READY, launch, session, sleep, target } from "./cdp.mjs";

const PORT = 9335;
const VIEWPORT = { width: 1600, height: 900 };
/** Events between two checks for a stuck state. */
const BURST = 50;
/** Share of pointer events aimed at something on the dock or in an open panel; the rest land anywhere low on the screen. */
const AIMED = 0.8;
/** How far from an item's centre an aimed event may land, in px either way. */
const JITTER = 10;
/** Height of the screen band the unaimed events land in, from the bottom. */
const LOW_BAND = 400;
/** Steps of a drag between press and release. */
const DRAG_STEPS = 8;
const REST = { x: 800, y: 200 };

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:1530/dock.html";
const opt = (name, fallback) => Number(args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback);
const EVENTS = opt("events", 5000);
const dpr = opt("dpr", 1);
let seed = opt("seed", 1);
/** Mulberry32. */
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(random() * list.length)];
const ACTIONS = ["move", "move", "move", "click", "click", "right", "middle", "drag", "wheel", "escape", "double"];

const errors = [];
const stuck = [];
const counts = {};
const seen = {};
let heap = null;
const chrome = launch(PORT, "soak-chrome");
try {
  const t = await target(PORT);
  const s = session(t.webSocketDebuggerUrl, (msg) => {
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  await s.send("Runtime.enable");
  await s.send("Performance.enable");
  await s.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: dpr, mobile: false });
  await s.send("Page.navigate", { url: `${url}?sample=1&panel=0&wall=meadow-dots-dark` });
  await s.evaluate(DOCK_READY);
  await sleep(800);
  const heapNow = async () => {
    await s.send("HeapProfiler.collectGarbage");
    return (await s.send("Performance.getMetrics")).metrics.find((m) => m.name === "JSHeapUsedSize").value;
  };
  const heapStart = await heapNow();
  const mouse = (type, x, y, button = "none", clickCount = 0, buttons = 0) => s.send("Input.dispatchMouseEvent", { type, x, y, button, clickCount, buttons });
  const press = async (x, y, button, buttons, clickCount = 1) => {
    await mouse("mousePressed", x, y, button, clickCount, buttons);
    await mouse("mouseReleased", x, y, button, clickCount, 0);
  };
  const escape = async () => {
    await s.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await s.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  };
  /** Centres of what can be used now, re-read each burst because the dock changes as it is used. */
  const spots = () =>
    s.evaluate(
      `[...document.querySelectorAll('.dock .slot, .popover[data-open="true"] button, .popover[data-open="true"] input, .menu [role="menuitem"], .library button')].map((el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }).filter(([x, y]) => x > 0 && y > 0 && x < ${VIEWPORT.width} && y < ${VIEWPORT.height})`,
    );
  const point = (list) => (list.length > 0 && random() < AIMED ? pick(list).map((v) => v + (random() * 2 - 1) * JITTER) : [random() * VIEWPORT.width, VIEWPORT.height - random() * LOW_BAND]);
  /** Records what is open now, so the summary shows the soak really reached the panels, menus and edit mode. */
  const note = async () => {
    const reached = await s.evaluate(`(() => [...document.querySelectorAll('.popover[data-open="true"], .menu')].map((el) => el.className.split(" ").slice(0, 2).join(".")).concat(window.dockDev.store.getState().editing ? ["edit-mode"] : [], window.dockDev.store.getState().libraryOpen ? ["app-library"] : []))()`);
    for (const what of new Set(reached)) seen[what] = (seen[what] ?? 0) + 1;
  };
  let done = 0;
  while (done < EVENTS) {
    const list = await spots();
    for (let i = 0; i < BURST && done < EVENTS; i += 1, done += 1) {
      const [x, y] = point(list);
      const action = pick(ACTIONS);
      counts[action] = (counts[action] ?? 0) + 1;
      if (action === "move") await mouse("mouseMoved", x, y);
      else if (action === "click") await press(x, y, "left", 1);
      else if (action === "double") {
        await press(x, y, "left", 1, 1);
        await press(x, y, "left", 1, 2);
      } else if (action === "right") await press(x, y, "right", 2);
      else if (action === "middle") await press(x, y, "middle", 4);
      else if (action === "drag") {
        await mouse("mousePressed", x, y, "left", 1, 1);
        const [tx, ty] = point(list);
        for (let step = 1; step <= DRAG_STEPS; step += 1) await mouse("mouseMoved", x + ((tx - x) * step) / DRAG_STEPS, y + ((ty - y) * step) / DRAG_STEPS, "left", 0, 1);
        await mouse("mouseReleased", tx, ty, "left", 1, 0);
      } else if (action === "wheel") await s.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: (random() * 2 - 1) * 200 });
      else await escape();
      if (action !== "move") await note();
    }
    // Back to rest the way a user would: Escape twice, a click on the empty desktop, the pointer away from the dock.
    await escape();
    await escape();
    await press(REST.x, REST.y, "left", 1);
    await mouse("mouseMoved", REST.x, REST.y);
    await sleep(250);
    const state = await s.evaluate(
      `(() => { const st = window.dockDev.store.getState(); return { dock: !!document.querySelector('.dock .slot'), open: document.querySelectorAll('.popover[data-open="true"], .menu').length, editing: st.editing, library: st.libraryOpen, dragging: !!document.querySelector('.dock [data-dragging="true"]') }; })()`,
    );
    if (!state.dock) stuck.push({ after: done, problem: "the dock stopped drawing" });
    if (state.open > 0) stuck.push({ after: done, problem: `${state.open} panel(s) still open after Escape and a desktop click` });
    if (state.library) stuck.push({ after: done, problem: "the App Library stayed open after Escape and a desktop click" });
    if (state.dragging) stuck.push({ after: done, problem: "a drag never ended" });
    // Edit mode is a real state random clicks can enter and Escape leaves; it must not survive the rest sequence.
    if (state.editing) stuck.push({ after: done, problem: "edit mode survived Escape and a desktop click" });
  }
  const heapEnd = await heapNow();
  heap = { startMB: +(heapStart / 1048576).toFixed(1), endMB: +(heapEnd / 1048576).toFixed(1) };
  s.close();
} catch (err) {
  errors.push(String(err));
} finally {
  await chrome.stop();
}
console.log(JSON.stringify({ events: EVENTS, seed: opt("seed", 1), counts, seen, errorCount: errors.length, errors: errors.slice(0, 20), stuckCount: stuck.length, stuck: stuck.slice(0, 20), heap }, null, 2));
process.exit(errors.length + stuck.length === 0 ? 0 : 1);

// Idle cost of the dock harness in headless Chrome: main-thread busy time, script time, layouts, style
// recalculations over a quiet window with the pointer away from the dock, with the default tiles on.
//
//   node tools/dock-tests/idle.mjs http://localhost:1530/dock.html [--seconds=30] [--tiles=clock,weather,media,battery,agenda]
//
// Needs `vite dev` running for apps/desktop (a dev build, so the real build costs less). Prints JSON; exits 1 when the
// main thread is busy more than the budget (0.2 % of one core, the owner's idle target).
import { DOCK_READY, launch, session, sleep, target } from "./cdp.mjs";

const PORT = 9336;
const VIEWPORT = { width: 1600, height: 900 };
const BUDGET_PERCENT = 0.2;
const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:1530/dock.html";
const seconds = Number(args.find((a) => a.startsWith("--seconds="))?.slice(10) ?? "30");
const tiles = (args.find((a) => a.startsWith("--tiles="))?.slice(8) ?? "clock,weather,media,battery,agenda").split(",");

const chrome = launch(PORT, "idle-chrome");
let result = null;
try {
  const t = await target(PORT);
  const s = session(t.webSocketDebuggerUrl);
  await s.send("Performance.enable");
  await s.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
  await s.send("Page.navigate", { url: `${url}?sample=1&panel=0&wall=meadow-dots-dark` });
  await s.evaluate(DOCK_READY);
  await s.evaluate(`window.dockDev.actions.updateSettings({ tiles: ${JSON.stringify(tiles)} })`);
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: VIEWPORT.width / 2, y: 100 });
  // Let the idle-time warm-up (stacks and the library mounted one per idle moment) finish before measuring.
  await sleep(5000);
  const read = async () => Object.fromEntries((await s.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const before = await read();
  await sleep(seconds * 1000);
  const after = await read();
  const delta = (key) => after[key] - before[key];
  const busy = delta("TaskDuration");
  result = {
    seconds,
    tiles,
    mainThreadBusyPercent: +((busy / seconds) * 100).toFixed(3),
    scriptMs: +(delta("ScriptDuration") * 1000).toFixed(1),
    layouts: delta("LayoutCount"),
    styleRecalcs: delta("RecalcStyleCount"),
    budgetPercent: BUDGET_PERCENT,
  };
  s.close();
} catch (err) {
  console.error(String(err));
} finally {
  await chrome.stop();
}
console.log(JSON.stringify(result, null, 2));
process.exit(result !== null && result.mainThreadBusyPercent <= BUDGET_PERCENT ? 0 : 1);

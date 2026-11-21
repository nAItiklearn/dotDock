// Pixel and frame audit of the dock harness, in headless Chrome, at 100 %, 125 % and 150 % scaling.
//
//   node tools/dock-tests/layout-audit.mjs http://localhost:1530/dock.html [--perf] [--dpr=1,1.25,1.5]
//
// Needs `vite dev` running for apps/desktop. Nothing is shown on screen. Exits 1 when any check fails, so it can
// gate a commit.

import { DOCK_READY, launch, session, target } from "./cdp.mjs";
const PORT = 9333;
const VIEWPORT = { width: 1600, height: 900 };
const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:1530/dock.html";
const wantPerf = args.includes("--perf");
const dprs = (args.find((a) => a.startsWith("--dpr="))?.slice(6) ?? "1,1.25,1.5").split(",").map(Number);
const tiles = ["flip", "sun", "wind", "currency", "memo"];

const chrome = launch(PORT, "audit-chrome");

let failed = 0;
const report = [];
try {
  const t = await target(PORT);
  const s = session(t.webSocketDebuggerUrl);
  for (const dpr of dprs) {
    await s.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: dpr, mobile: false });
    await s.send("Page.navigate", { url: `${url}?sample=1` });
    await s.evaluate(DOCK_READY);
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
  await chrome.stop();
}
console.log(JSON.stringify(report, null, 2));
process.exit(failed === 0 ? 0 : 1);

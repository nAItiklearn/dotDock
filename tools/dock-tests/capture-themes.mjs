// Screenshots of the dock in each theme over the Wind Meadow wallpaper, in headless Chrome.
//
//   node tools/dock-tests/capture-themes.mjs http://localhost:1530/dock.html <out-dir> [glass,obsidian,...] [--dpr=1]
//
// Needs `vite dev` running for apps/desktop. Writes <theme>.png (the bottom band of the screen, where the dock is).
import { DOCK_READY, launch, session, target } from "./cdp.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
const chrome = launch(PORT, "capture-chrome");

let failed = 0;
try {
  const t = await target(PORT);
  const s = session(t.webSocketDebuggerUrl);
  await s.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: dpr, mobile: false });
  for (const theme of themes) {
    await s.send("Page.navigate", { url: `${url}?sample=1&panel=0&wall=meadow-dots-dark&dock-theme=${theme}` });
    await s.evaluate(DOCK_READY);
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
  await chrome.stop();
}
process.exit(failed === 0 ? 0 : 1);

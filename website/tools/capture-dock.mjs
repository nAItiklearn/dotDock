// Captures the dock's features for the Features page from the dock UI harness (apps/desktop `vite dev`, dock.html),
// over the Wind Meadow grass wallpaper, with the DEV panel left out (?panel=0). Every picture is the real dock code
// running in a browser; nothing is drawn by hand.
//
// Usage: serve the dock UI worktree (`npx vite --port 4340` in apps/desktop), then
//   node tools/capture-dock.mjs [only-these-names,comma,separated]
// Writes src/assets/features/<name>.webp at 2x.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { launch, profileDir, sleep } from "./cdp.mjs";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "src", "assets", "features");
const HARNESS = process.env.DOCK_HARNESS ?? "http://127.0.0.1:4340/dock.html";
const W = 1600;
const H = 900;
const SCALE = 2;
/** Clips are measured after the shot is set up: the dock plus any open menu or popover, never cut at an edge. */
const DOCK = { fit: true, above: 220 };
/** The dock with room above it for a popover. */
const TALL = { fit: true, above: 560 };
const FULL = { x: 0, y: 0, width: W, height: H };
/** Wallpaper kept around the fitted content on each side, in CSS pixels. */
const MARGIN = 36;
/** Bounding box of the dock and every visible overlay, as [left, top, right, bottom]. */
const BOUNDS = `(() => { const els = [...document.querySelectorAll('.dock, .menu, [role=menu], [role=dialog], .popover, .preview, .stack, .gallery')].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && (e.classList.contains('dock') || (r.width < innerWidth * 0.9 && r.height < innerHeight * 0.9)) && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.5 && r.top >= 0; }); const rs = els.map((e) => e.getBoundingClientRect()); return [Math.min(...rs.map((r) => r.left)), Math.min(...rs.map((r) => r.top)), Math.max(...rs.map((r) => r.right)), Math.max(...rs.map((r) => r.bottom))]; })()`;

async function fitClip(c, clip) {
  if (!clip.fit) return clip;
  const [l, t, r, b] = await c.eval(BOUNDS);
  const x = Math.max(0, Math.floor(l - MARGIN));
  const right = Math.min(W, Math.ceil(r + MARGIN));
  const bottom = Math.min(H, Math.ceil(b + MARGIN));
  const y = Math.max(0, Math.min(Math.floor(t - MARGIN), bottom - clip.above));
  return { x, y, width: right - x, height: bottom - y };
}

const st = (code) => `dockDev.store.getState().${code}`;
const settings = (patch) => `dockDev.dev.patchSettings(${JSON.stringify(patch)})`;
/** Centre of the dock item whose accessible name starts with `name`. */
const centre = (name) => `(() => { const el = [...document.querySelectorAll('.dock__row > .slot')].find((s) => (s.querySelector('[aria-label]')?.getAttribute('aria-label') ?? '').startsWith(${JSON.stringify(name)})); if (!el) throw new Error('no dock item ' + ${JSON.stringify(name)}); const r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()`;

const GAP_A = ["network", "sun", "wind", "flip", "analog"];
const GAP_B = ["currency", "search", "history", "memo", "audio"];
const GAP_C = ["focus", "hydration", "progress", "emoji", "mic"];
const SYSTEM = ["system", "cpu", "battery", "toggles", "world"];
const DAY = ["agenda", "meeting", "stopwatch", "reminders", "contacts"];

/** Each shot: setup expressions run in the page, then pointer steps, then the clip. */
const SHOTS = [
  ...["glass", "glass-lite", "obsidian", "paper", "aurum", "minimal"].map((theme) => ({ name: `theme-${theme}`, setup: [st(`setThemeChoice("${theme}")`)], clip: DOCK })),
  { name: "magnify", hover: "Development", clip: DOCK },
  { name: "stack", click: "Development", clip: TALL },
  { name: "library", setup: [st("setLibrary(true)")], clip: FULL },
  { name: "categories", click: "Productivity", clip: TALL },
  { name: "menu", rightClick: "Atlas Browser", clip: TALL },
  { name: "previews", hover: "Atlas Browser", wait: 1600, clip: TALL },
  { name: "edit", setup: [st("setEditing(true)")], clip: DOCK },
  { name: "prefs", click: "Customise the dock", clip: TALL },
  { name: "gallery", rightClick: "Atlas Browser", menuItem: "Add a widget", clip: TALL },
  { name: "tile-agenda", setup: [settings({ tiles: DAY })], clickTile: "agenda", clip: TALL },
  { name: "tile-system", setup: [settings({ tiles: SYSTEM })], clickTile: "system", clip: TALL },
  { name: "tile-focus", setup: [settings({ tiles: GAP_C })], clickTile: "focus", clip: TALL },
  { name: "tiles-gap-a", setup: [settings({ tiles: GAP_A })], clip: DOCK },
  { name: "tiles-gap-b", setup: [settings({ tiles: GAP_B })], clip: DOCK },
  { name: "tiles-gap-c", setup: [settings({ tiles: GAP_C })], clip: DOCK },
  { name: "tiles-system", setup: [settings({ tiles: SYSTEM })], clip: DOCK },
  { name: "tiles-day", setup: [settings({ tiles: DAY })], clip: DOCK },
  { name: "badges", setup: [`dockDev.dev.install("Lumen Notes", "utilities")`], clip: DOCK },
  { name: "edge-left", setup: [settings({ edge: "left" })], clip: FULL },
  { name: "desktop", clip: FULL },
];

/** Clicks the live tile with this id, which opens its popover. */
async function tileClick(c, id) {
  const at = await c.eval(`(() => { const t = document.querySelector('.dock__row > .slot[data-tile="${id}"]'); if (!t) throw new Error('no tile ${id}'); const r = t.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()`);
  await c.click(at[0], at[1]);
}

async function run(only) {
  mkdirSync(OUT, { recursive: true });
  const c = await launch({ profile: profileDir(ROOT) });
  try {
    await c.viewport(W, H, SCALE);
    for (const shot of SHOTS) {
      if (only && !only.includes(shot.name)) continue;
      await c.goto(`${HARNESS}?panel=0&wall=meadow-dots-dark`, 600);
      await c.eval("localStorage.clear()");
      await c.goto(`${HARNESS}?panel=0&wall=meadow-dots-dark`, 2500);
      await c.eval(st("setLibrary(false)"));
      for (const expr of shot.setup ?? []) await c.eval(expr);
      await sleep(900);
      await c.mouse("mouseMoved", W / 2, 120);
      if (shot.hover) {
        const [x, y] = await c.eval(centre(shot.hover));
        await c.move(x, y);
        await sleep(shot.wait ?? 600);
      }
      if (shot.clickTile !== undefined) await tileClick(c, shot.clickTile);
      else if (shot.click) {
        const [x, y] = await c.eval(centre(shot.click));
        await c.click(x, y);
      }
      if (shot.rightClick) {
        const [x, y] = await c.eval(centre(shot.rightClick));
        await c.click(x, y, "right");
        await sleep(500);
        if (shot.menuItem) {
          const [mx, my] = await c.eval(`(() => { const el = [...document.querySelectorAll('.menu .menu__item')].find((e) => e.textContent.startsWith(${JSON.stringify(shot.menuItem)})); const r = el.getBoundingClientRect(); return [Math.round(r.x + 20), Math.round(r.y + r.height / 2)]; })()`);
          await c.click(mx, my);
        }
      }
      if (!shot.hover) await c.eval("document.activeElement && document.activeElement.blur && document.activeElement.blur()");
      await sleep(900);
      const clip = await fitClip(c, shot.clip);
      if (process.env.CAPTURE_DEBUG) console.log(shot.name, JSON.stringify(clip));
      const png = await c.shot(clip);
      const file = join(OUT, `${shot.name}.webp`);
      writeFileSync(file, await sharp(png).webp({ quality: 84, effort: 5 }).toBuffer());
      console.log(`${shot.name}: ${c.logs.length ? `page errors: ${c.logs.splice(0).join(" / ").slice(0, 200)}` : "ok"}`);
    }
  } finally {
    c.close();
  }
}

await run(process.argv[2]?.split(","));

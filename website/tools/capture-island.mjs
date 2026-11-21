// Captures the agent island for the Features page from the island UI (apps/desktop `vite dev`, island.html) in a
// plain browser, fed by the island's own fixture backend. Each picture is the real island code; the island is cut
// out with a transparent background and laid over the top of the Wind Meadow wallpaper, where it sits on a desktop.
//
// Usage: serve the notch worktree (`npx vite --port 4341` in apps/desktop), then
//   node tools/capture-island.mjs [only-these-names,comma,separated]
// Writes src/assets/island/<name>.webp at 2x.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { launch, profileDir, sleep } from "./cdp.mjs";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "src", "assets", "island");
const HARNESS = process.env.ISLAND_HARNESS ?? "http://localhost:4341/island.html";
const WALLPAPER = join(ROOT, "src", "assets", "wallpapers", "meadow-dots-dark-1920.webp");
const SCREEN_W = 1920;
const SCALE = 2;
/** The part of the top of a 1920-wide screen each card shows, in CSS pixels, with the island centred in it. */
const FRAME = { width: 520, height: 170 };
/** Seconds of settling after a snapshot, so the island's own transition has finished. */
const SETTLE_MS = 1800;

/** One session per entry: its phase and, when given, the agent that runs it. */
const SHOTS = [
  { name: "thinking", sessions: [{ phase: "thinking" }] },
  { name: "reading", sessions: [{ phase: "reading" }] },
  { name: "running", sessions: [{ phase: "running" }] },
  { name: "waiting", sessions: [{ phase: "waiting" }] },
  { name: "done", sessions: [{ phase: "done" }] },
  { name: "limit", sessions: [{ phase: "limit" }] },
  { name: "error", sessions: [{ phase: "error" }] },
  { name: "codex", sessions: [{ phase: "editing", agent: "codex", label: "Codex" }] },
  { name: "copilot", sessions: [{ phase: "running", agent: "copilot", label: "Copilot CLI" }] },
  { name: "opencode", sessions: [{ phase: "searching", agent: "opencode", label: "OpenCode" }] },
  { name: "two", sessions: [{ phase: "running" }, { phase: "thinking", agent: "codex", label: "Codex" }] },
];

const push = (sessions) => `(async () => {
  const f = await import('/src/island/dev/fixtures.ts');
  const b = await import('/src/island/dev/devBackend.ts');
  const want = ${JSON.stringify(sessions)};
  const snap = f.buildSnapshot({ ...f.DEFAULT_SCENARIO, codexSecond: false, phases: want.map((s) => s.phase) }, Date.now(), null);
  b.dev.pushSnapshot({ ...snap, sessions: snap.sessions.map((s, i) => (want[i].agent ? { ...s, agent: want[i].agent, agentLabel: want[i].label } : s)) });
})()`;

/** Horizontal centre of the island plate, in CSS pixels. */
const CENTRE = `(() => { const r = document.querySelector('.island-slide').getBoundingClientRect(); return r.x + r.width / 2; })()`;

async function run(only) {
  mkdirSync(OUT, { recursive: true });
  const top = await sharp(WALLPAPER)
    .resize(SCREEN_W * SCALE)
    .extract({ left: ((SCREEN_W - FRAME.width) / 2) * SCALE, top: 0, width: FRAME.width * SCALE, height: FRAME.height * SCALE })
    .toBuffer();
  const c = await launch({ profile: profileDir(ROOT) });
  try {
    await c.viewport(1200, 600, SCALE);
    await c.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    for (const shot of SHOTS) {
      if (only && !only.includes(shot.name)) continue;
      await c.goto(HARNESS, 2500);
      await c.eval(
        "document.getElementById('dev-panel')?.remove(); document.getElementById('root').classList.remove('dev-frame'); for (const el of [document.documentElement, document.body]) el.style.background = 'transparent';",
      );
      await c.eval(push(shot.sessions));
      await sleep(SETTLE_MS);
      const centre = await c.eval(CENTRE);
      const png = await c.shot({ x: Math.round(centre - FRAME.width / 2), y: 0, width: FRAME.width, height: FRAME.height });
      const out = await sharp(top).composite([{ input: png }]).webp({ quality: 86, effort: 5 }).toBuffer();
      writeFileSync(join(OUT, `${shot.name}.webp`), out);
      console.log(`${shot.name}: ${c.logs.length ? `page errors: ${c.logs.splice(0).join(" / ").slice(0, 200)}` : "ok"}`);
    }
  } finally {
    c.close();
  }
}

await run(process.argv[2]?.split(","));

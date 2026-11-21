// Hard live test of the running island: random agent events and random real mouse input at a human pace, at once.
//   node tools/capture/island-soak.mjs <debug-port> [seconds=180] [seed=1]
// A child process writes feed events for a few sessions (every phase, tokens, problems), with its own pid; the
// real cursor hovers, flicks across, clicks, right-clicks, swipes and pages the island, and takes focus away from
// it. While that runs the island page is timed frame by frame and probed four times a second. At the end the
// child is killed (a crashed agent): every session must turn Stopped and the island must fold back to its
// standby pill. Fails (exit 1) on any console error or exception, any dropped frame, the island left slid aside
// with the cursor gone (or not aside with it there), a plate that never settles at its size, or no return to
// standby. Prints one JSON report.

import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Deterministic random numbers, so a failing run can be replayed with its seed. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x1_0000_0000;
  };
}
const between = (rand, lo, hi) => lo + rand() * (hi - lo);
const pick = (rand, list) => list[Math.floor(rand() * list.length)];

// ---------------------------------------------------------------------------------------------------------------
// Feed writer (child process): `island-soak.mjs --feed <seed>` until killed.

const PHASES = [
  // [phase, weight]
  ['thinking', 20], ['reading', 14], ['searching', 8], ['editing', 12], ['running', 14],
  ['waiting', 6], ['done', 8], ['paused', 3], ['limit', 3], ['error', 4], ['tokens', 8],
];
const PROBLEMS = [
  { kind: 'usage_limit', message: 'Session limit', resets: '5pm' },
  { kind: 'login', message: 'Signed out' },
  { kind: 'connection', message: 'Offline' },
  { kind: 'overloaded', message: 'Server busy' },
];
const DETAILS = ['lib.rs', 'Island.tsx', 'cargo test', 'TODO|FIXME', 'Run npm test?', 'README.md', 'pnpm build'];
const SESSIONS = 4;
/** Pause between two feed events, ms: from a burst of tool calls to a long think. */
const FEED_GAP_MS = [180, 1600];

function feed(seed) {
  const rand = rng(seed * 7919);
  const dir = join(process.env.LOCALAPPDATA ?? '', 'dev.dotdock.desktop', 'agents');
  const file = join(dir, `soak-${process.pid}.jsonl`);
  mkdirSync(dir, { recursive: true });
  rmSync(file, { force: true });
  const tokens = new Array(SESSIONS).fill(0);
  const total = PHASES.reduce((n, [, w]) => n + w, 0);
  const write = () => {
    const s = Math.floor(rand() * SESSIONS);
    let roll = rand() * total;
    const [phase] = PHASES.find(([, w]) => (roll -= w) < 0) ?? PHASES[0];
    const base = { v: 1, agent: 'soak', name: 'Soak', session: `s${s}`, at: Date.now(), pid: process.pid, cwd: `D:\\work\\soak-${s}` };
    let line;
    if (phase === 'tokens') {
      tokens[s] += Math.floor(between(rand, 20, 900));
      line = { ...base, tokens_out: tokens[s] };
    } else {
      if (['done', 'paused', 'limit', 'error'].includes(phase)) tokens[s] = 0;
      line = { ...base, phase, tool: 'shell', detail: pick(rand, DETAILS) };
      if (phase === 'done') line.summary = 'Fixed the header layout.';
      if (phase === 'limit') line.problem = PROBLEMS[0];
      if (phase === 'error') line.problem = pick(rand, PROBLEMS.slice(1));
    }
    appendFileSync(file, `${JSON.stringify(line)}\n`);
    setTimeout(write, between(rand, ...FEED_GAP_MS));
  };
  write();
}

// ---------------------------------------------------------------------------------------------------------------
// Driver.

/** Probe of the island page: mode, slide, plate size against its target, hover footprint, in window CSS px. */
const PROBE = `(() => {
  const el = document.querySelector('.island');
  const slide = document.querySelector('.island-slide');
  const plate = document.querySelector('.island__plate');
  if (!el || !slide || !plate) return null;
  const mode = ['island', 'tiny', 'hidden'].find((m) => el.classList.contains('island--' + m)) ?? 'off';
  const rest = { x: slide.offsetLeft + el.offsetLeft, y: slide.offsetTop + el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  const p = plate.getBoundingClientRect();
  const label = document.querySelector('.island__active')?.innerText ?? '';
  return { mode, aside: el.classList.contains('island--aside'), rest, plate: { w: p.width, h: p.height },
           slideY: new DOMMatrix(getComputedStyle(slide).transform).m42, label, dpr: devicePixelRatio,
           pager: [...document.querySelectorAll('.pager__hit')].map((b) => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }) };
})()`;

const FRAMES = (ms) => `new Promise((done) => {
  const gaps = []; const at = []; let last = 0; const until = performance.now() + ${ms};
  const step = (now) => { if (last) { gaps.push(now - last); at.push(Date.now()); } last = now;
    if (now < until) requestAnimationFrame(step);
    else { const s = [...gaps].sort((a, b) => a - b); const iv = s[Math.floor(s.length / 2)] || 0;
      done({ frames: gaps.length + 1, refreshHz: Math.round(1000 / iv), medianMs: +iv.toFixed(2),
             p99Ms: +(s[Math.floor(s.length * 0.99)] || 0).toFixed(2), worstMs: +(s.at(-1) || 0).toFixed(2),
             dropped: gaps.filter((g) => g > iv * 1.5).length,
             drops: gaps.flatMap((g, i) => (g > iv * 1.5 ? [{ at: at[i], ms: +g.toFixed(1) }] : [])) }); } };
  requestAnimationFrame(step); })`;

/** Margin of the hover footprint around the plate (src/island/regions.ts HOVER_MARGIN). */
const HOVER_MARGIN = 16;
/** How long the slide may take to follow the cursor before it counts as stuck. */
const SETTLE_MS = 1500;
/** Probe period. */
const PROBE_MS = 250;
/** Longest wait for standby after the agents crash: stop detection plus the done linger, with room. */
const STANDBY_WITHIN_MS = 20_000;
/** A plate that has settled is within this many CSS px of its target size. */
const PLATE_TOLERANCE = 1.5;
/** Pause between two mouse actions, ms. */
const ACTION_GAP_MS = [250, 1100];
/** Cursor step while gliding, ms (one 60 Hz frame). */
const GLIDE_STEP_MS = 16;

async function cdp(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === 'page' && t.url.includes('island'));
  if (!page) throw new Error('no island page among the debug targets');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
  let id = 0;
  const waiting = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  });
  const send = (method, params = {}) => new Promise((ok) => { waiting.set(++id, ok); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  return { send, evaluate, on: (l) => listeners.push(l), close: () => ws.close() };
}

function inputHelper() {
  const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(HERE, 'input.ps1')], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buffer = '';
  const queue = [];
  ps.stdout.on('data', (d) => {
    buffer += d;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      queue.shift()?.(line);
    }
  });
  const cmd = (line) => new Promise((ok) => { queue.push(ok); ps.stdin.write(`${line}\n`); });
  return { cmd, quit: () => { ps.stdin.write('quit\n'); ps.stdin.end(); } };
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function drive(port, seconds, seed) {
  const rand = rng(seed);
  const page = await cdp(port);
  const problems = [];
  const errors = [];
  page.on((m) => {
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert'))
      errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`);
  });
  await page.send('Runtime.enable');
  await page.send('Log.enable');

  const input = inputHelper();
  const rectLine = await input.cmd('rect Agent Island');
  if (!rectLine.startsWith('rect ')) throw new Error('no Agent Island window');
  const [left, top] = rectLine.split(' ').slice(1).map(Number);
  const first = await page.evaluate(PROBE);
  const dpr = first?.dpr ?? 1;
  const toScreen = (x, y) => [Math.round(left + x * dpr), Math.round(top + y * dpr)];

  // Where the driver last put the cursor, in window CSS px, and since when.
  let cursor = { x: first.rest.x + first.rest.w / 2, y: 400, since: performance.now() };
  const place = async (x, y) => {
    const [sx, sy] = toScreen(x, y);
    await input.cmd(`move ${sx} ${sy}`);
    cursor = { x, y, since: performance.now() };
  };
  const glide = async (x, y, ms) => {
    const from = { ...cursor };
    const steps = Math.max(1, Math.round(ms / GLIDE_STEP_MS));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t * t * (3 - 2 * t);
      await place(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      await sleep(GLIDE_STEP_MS);
    }
  };

  const feeder = spawn(process.execPath, [fileURLToPath(import.meta.url), '--feed', String(seed)], { stdio: 'ignore' });
  const frames = page.evaluate(FRAMES(seconds * 1000));

  const counts = {};
  const stableSince = { key: '', at: performance.now() };
  let probes = 0;
  let last = first;
  const check = (s) => {
    probes++;
    last = s;
    const now = performance.now();
    const fp = { x: s.rest.x - HOVER_MARGIN, y: 0, w: s.rest.w + 2 * HOVER_MARGIN, h: s.rest.y + s.rest.h + HOVER_MARGIN };
    const inside = cursor.x >= fp.x && cursor.x <= fp.x + fp.w && cursor.y >= fp.y && cursor.y <= fp.y + fp.h;
    const key = `${s.mode}|${s.rest.w}|${s.rest.h}|${s.aside}|${inside}`;
    if (key !== stableSince.key) Object.assign(stableSince, { key, at: now });
    const steady = now - Math.max(stableSince.at, cursor.since) > SETTLE_MS;
    if (!steady) return;
    if (s.mode === 'island' && s.aside !== inside)
      problems.push({ at: Math.round(now), what: inside ? 'cursor on the island but it did not move aside' : 'island stuck aside with the cursor gone', s, cursor });
    if (s.mode !== 'island' && s.aside) problems.push({ at: Math.round(now), what: 'aside while not active', s });
    const visibleW = s.mode === 'hidden' ? s.plate.w : s.rest.w;
    if (Math.abs(s.plate.w - visibleW) > PLATE_TOLERANCE || (s.mode !== 'hidden' && Math.abs(s.plate.h - s.rest.h) > PLATE_TOLERANCE))
      problems.push({ at: Math.round(now), what: 'plate never settled at its size', s });
  };
  const prober = setInterval(async () => {
    const s = await page.evaluate(PROBE);
    if (s) check(s);
    else problems.push({ what: 'island element missing' });
  }, PROBE_MS);

  const plateCentre = () => ({ x: last.rest.x + last.rest.w / 2, y: last.rest.y + last.rest.h / 2 });
  const away = () => ({ x: between(rand, 0, 500), y: last.rest.y + last.rest.h + HOVER_MARGIN + between(rand, 60, 400) });
  const ACTIONS = {
    async hover() { const c = plateCentre(); await glide(c.x + between(rand, -80, 80), c.y, between(rand, 150, 400)); await sleep(between(rand, 300, 1500)); },
    async leave() { const a = away(); await glide(a.x, a.y, between(rand, 150, 400)); },
    async flick() { const c = plateCentre(); await glide(c.x, c.y, 90); const a = away(); await glide(a.x, a.y, 90); },
    async click() { const c = plateCentre(); const [x, y] = toScreen(c.x, c.y); await input.cmd(`left ${x} ${y}`); cursor = { ...c, since: performance.now() }; },
    async rightClick() { const c = plateCentre(); const [x, y] = toScreen(c.x, c.y); await input.cmd(`right ${x} ${y}`); cursor = { ...c, since: performance.now() }; },
    async swipe() { const c = plateCentre(); await place(c.x, c.y); for (let i = 0; i < 3; i++) { await input.cmd(`hwheel ${rand() < 0.5 ? 120 : -120}`); await sleep(40); } },
    async page() { if (!last.pager.length) return; const d = pick(rand, last.pager); const [x, y] = toScreen(d.x, d.y); await input.cmd(`left ${x} ${y}`); cursor = { ...d, since: performance.now() }; },
    async blur() { const a = away(); await glide(a.x, a.y, 200); await input.cmd('activate dotDock test backdrop'); },
    async rest() { await sleep(between(rand, 800, 2500)); },
  };
  const names = Object.keys(ACTIONS);
  const timeline = [];
  const until = performance.now() + seconds * 1000;
  while (performance.now() < until) {
    const name = pick(rand, names);
    counts[name] = (counts[name] ?? 0) + 1;
    timeline.push({ at: Date.now(), action: name });
    await ACTIONS[name]();
    await sleep(between(rand, ...ACTION_GAP_MS));
  }
  const pacing = await frames;

  // The agents crash; the cursor leaves. Every session must stop and the island must fold to standby.
  const a = away();
  await glide(a.x, a.y, 300);
  feeder.kill();
  const crashedAt = performance.now();
  let standbyMs = null;
  while (performance.now() - crashedAt < STANDBY_WITHIN_MS) {
    const s = await page.evaluate(PROBE);
    if (s && s.mode !== 'island' && !s.aside) { standbyMs = Math.round(performance.now() - crashedAt); break; }
    await sleep(PROBE_MS);
  }
  await sleep(SETTLE_MS);
  clearInterval(prober);
  const final = await page.evaluate(PROBE);
  if (standbyMs === null) problems.push({ what: `no standby within ${STANDBY_WITHIN_MS} ms after the agents crashed`, s: final });
  if (pacing.dropped > 0) problems.push({ what: `${pacing.dropped} dropped frame(s)` });
  if (errors.length) problems.push({ what: `${errors.length} console error(s)`, errors: errors.slice(0, 10) });

  input.quit();
  page.close();
  // Each dropped frame with the action that was running when it fell, to tell the island's own work from noise.
  const drops = pacing.drops.map((d) => ({ ...d, during: timeline.findLast((t) => t.at <= d.at)?.action ?? 'start' }));
  delete pacing.drops;
  const report = { seconds, seed, actions: counts, probes, pacing, drops, standbyMs, final: final && { mode: final.mode, aside: final.aside, plate: final.plate }, problems: problems.slice(0, 20), problemCount: problems.length, pass: problems.length === 0 };
  console.log(JSON.stringify(report, null, 1));
  process.exitCode = report.pass ? 0 : 1;
}

const args = process.argv.slice(2);
if (args[0] === '--feed') feed(Number(args[1] ?? 1));
else if (!args[0]) {
  console.error('usage: node island-soak.mjs <debug-port> [seconds] [seed]');
  process.exit(1);
} else await drive(Number(args[0]), Number(args[1] ?? 180), Number(args[2] ?? 1));

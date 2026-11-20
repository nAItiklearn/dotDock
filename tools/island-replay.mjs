#!/usr/bin/env node
// Plays a recorded agent session onto the running island, at a pace a person can follow, for the live test.
//
// The recordings are the integration-test fixtures in apps/desktop/src-tauri/island/tests/fixtures. Each line is
// delivered the way the real agent delivers it, with its times moved to now:
//   codex     appended to a rollout log under <codex-home>\sessions\YYYY\MM\DD (start the app with CODEX_HOME=<codex-home>)
//   copilot   piped into the real hook program, exactly as Copilot CLI runs it (`--agent copilot --event <name>`)
//   opencode  appended to the feed folder in the OpenCode plugin's format
//   generic   appended to the feed folder in the agent feed protocol (docs/ISLAND_PROTOCOL.md)
// Lines the island must skip (the fixtures carry some on purpose) are delivered too.
//
// Usage:
//   node tools/island-replay.mjs --agent <codex|copilot|opencode|generic> --hook <dotdock-island-hook.exe>
//        [--codex-home <dir>] [--pace <ms>] [--hold <ms>] [--shots <dir> --prefix <nn> [--crop x,y,w,h]]
//
// With --shots, the screen is captured (tools/capture/screenshot.ps1) after every line the island can read.
// The process stays alive for --hold ms after the last line; feed sessions carry this process's id, so when it
// exits the island shows them as Stopped, which is how a crashed agent looks.

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'apps', 'desktop', 'src-tauri', 'island', 'tests', 'fixtures');
const SCREENSHOT = join(ROOT, 'tools', 'capture', 'screenshot.ps1');
const FEED_DIR = join(process.env.LOCALAPPDATA ?? '', 'dev.dotdock.desktop', 'agents');
const CODEX_ID = '01a04e65-47c8-70c1-b898-8d5452cb24b0';
/// Time for the island's animation to settle before a capture.
const SETTLE_MS = 900;

const FIXTURE = { codex: 'codex-rollout.jsonl', copilot: 'copilot-hooks.jsonl', opencode: 'opencode-feed.jsonl', generic: 'generic-feed.jsonl' };

function args() {
  const out = { pace: 2600, hold: 4000 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!FIXTURE[out.agent]) throw new Error(`--agent must be one of ${Object.keys(FIXTURE).join(', ')}`);
  if (out.agent === 'copilot' && !out.hook) throw new Error('--hook <dotdock-island-hook.exe> is required for copilot');
  if (out.agent === 'codex' && !out['codex-home']) throw new Error('--codex-home <dir> is required for codex');
  out.pace = Number(out.pace);
  out.hold = Number(out.hold);
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parse = (line) => {
  try {
    const v = JSON.parse(line);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
};
const slug = (text) => String(text).replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/// One recorded line, rewritten for now. Returns what to deliver and a label for the capture (null: unreadable).
function prepare(agent, line, now) {
  const v = parse(line);
  if (agent === 'codex') {
    if (!v || !v.timestamp) return { raw: line, label: null };
    v.timestamp = new Date(now).toISOString();
    if (v.payload?.started_at) v.payload.started_at = Math.floor(now / 1000);
    return { raw: JSON.stringify(v), label: slug(v.payload?.type ?? v.type) };
  }
  if (agent === 'copilot') {
    if (!v || !v.payload) return { raw: line, label: null };
    v.payload.timestamp = now;
    return { event: v.event, raw: JSON.stringify(v.payload), label: v.payload.sessionId ? slug(v.event) : null };
  }
  if (agent === 'opencode') {
    if (!v || !v.event) return { raw: line, label: null };
    v.event.created = now;
    v.pid = process.pid;
    return { raw: JSON.stringify(v), label: slug(v.event.type) };
  }
  if (!v || v.v !== 1 || typeof v.session !== 'string') return { raw: line, label: null };
  if (v.at) v.at = now;
  if (v.pid) v.pid = process.pid;
  return { raw: JSON.stringify(v), label: slug(v.phase ?? (v.tokens_out ? 'tokens' : 'update')) };
}

function deliver(agent, opts, item) {
  if (agent === 'copilot') {
    if (!item.event) return;
    spawnSync(opts.hook, ['--agent', 'copilot', '--event', item.event, '--spool', FEED_DIR], { input: item.raw, windowsHide: true });
    return;
  }
  appendFileSync(opts.target, `${item.raw}\n`);
}

function capture(opts, index, label) {
  const file = join(opts.shots, `${opts.prefix}-${String(index).padStart(2, '0')}-${opts.agent}-${label}.png`);
  const crop = opts.crop ? ['-Crop', opts.crop] : [];
  spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCREENSHOT, '-Out', file, ...crop], { windowsHide: true });
  console.log(`  captured ${file}`);
}

async function main() {
  const opts = args();
  const { agent } = opts;
  mkdirSync(FEED_DIR, { recursive: true });
  if (agent === 'codex') {
    const day = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const folder = join(opts['codex-home'], 'sessions', String(day.getFullYear()), pad(day.getMonth() + 1), pad(day.getDate()));
    mkdirSync(folder, { recursive: true });
    opts.target = join(folder, `rollout-${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T00-00-00-${CODEX_ID}.jsonl`);
  } else if (agent === 'copilot') {
    rmSync(join(FEED_DIR, 'copilot-c0p1lot-7f3e.jsonl'), { force: true });
  } else {
    opts.target = join(FEED_DIR, `${agent}-replay.jsonl`);
  }
  if (opts.target) rmSync(opts.target, { force: true });
  if (opts.shots) mkdirSync(opts.shots, { recursive: true });

  const lines = readFileSync(join(FIXTURES, FIXTURE[agent]), 'utf8').split('\n').filter(Boolean);
  let shot = 0;
  for (const line of lines) {
    const item = prepare(agent, line, Date.now());
    deliver(agent, opts, item);
    console.log(`${new Date().toISOString()} ${agent} ${item.label ?? '(unreadable line, the island must skip it)'}`);
    if (opts.shots && item.label) {
      await sleep(SETTLE_MS);
      capture(opts, ++shot, item.label);
    }
    await sleep(opts.pace);
  }
  console.log(`holding for ${opts.hold} ms, then exiting (feed sessions show Stopped)`);
  await sleep(opts.hold);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

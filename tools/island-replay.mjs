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

export const FIXTURE = { codex: 'codex-rollout.jsonl', copilot: 'copilot-hooks.jsonl', opencode: 'opencode-feed.jsonl', generic: 'generic-feed.jsonl' };
/// Phases of the agent feed protocol (docs/ISLAND_PROTOCOL.md, section 3); a line naming another is skipped.
const PHASES = new Set(['thinking', 'reading', 'searching', 'editing', 'running', 'waiting', 'done', 'paused', 'limit', 'error', 'stopped', 'idle']);
const OPTIONS = new Set(['agent', 'hook', 'codex-home', 'pace', 'hold', 'shots', 'prefix', 'crop']);
/// Default time between two lines and after the last one: long enough to read each state on screen.
const DEFAULT_PACE_MS = 2600;
const DEFAULT_HOLD_MS = 4000;

export function parseArgs(argv) {
  const out = { pace: DEFAULT_PACE_MS, hold: DEFAULT_HOLD_MS };
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].replace(/^--/, '');
    if (!OPTIONS.has(name) || argv[i + 1] === undefined) throw new Error(`unknown option or missing value: ${argv[i]}`);
    out[name] = argv[i + 1];
  }
  if (!FIXTURE[out.agent]) throw new Error(`--agent must be one of ${Object.keys(FIXTURE).join(', ')}`);
  if (out.agent === 'copilot' && !out.hook) throw new Error('--hook <dotdock-island-hook.exe> is required for copilot');
  if (out.agent === 'codex' && !out['codex-home']) throw new Error('--codex-home <dir> is required for codex');
  if (out.shots && !out.prefix) throw new Error('--shots needs --prefix <nn>');
  out.pace = Number(out.pace);
  out.hold = Number(out.hold);
  if (!(out.pace >= 0) || !(out.hold >= 0)) throw new Error('--pace and --hold are milliseconds, 0 or more');
  return out;
}

/// The rollout file Codex itself would write today, under <codex-home>\sessions\YYYY\MM\DD.
export function codexRolloutPath(home, day) {
  const pad = (n) => String(n).padStart(2, '0');
  const [y, m, d] = [String(day.getFullYear()), pad(day.getMonth() + 1), pad(day.getDate())];
  return join(home, 'sessions', y, m, d, `rollout-${y}-${m}-${d}T00-00-00-${CODEX_ID}.jsonl`);
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

/// One recorded line, rewritten for now and for this process. Returns what to deliver and a label for the capture
/// (null: a line the island skips).
export function prepare(agent, line, now, pid = process.pid) {
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
    v.pid = pid;
    return { raw: JSON.stringify(v), label: slug(v.event.type) };
  }
  if (!v || v.v !== 1 || typeof v.session !== 'string') return { raw: line, label: null };
  if (v.at) v.at = now;
  if (v.pid) v.pid = pid;
  if (v.phase !== undefined && !PHASES.has(v.phase)) return { raw: JSON.stringify(v), label: null };
  return { raw: JSON.stringify(v), label: slug(v.phase ?? (typeof v.tokens_out === 'number' ? 'tokens' : 'update')) };
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
  const opts = parseArgs(process.argv.slice(2));
  const { agent } = opts;
  mkdirSync(FEED_DIR, { recursive: true });
  if (agent === 'codex') {
    opts.target = codexRolloutPath(opts['codex-home'], new Date());
    mkdirSync(dirname(opts.target), { recursive: true });
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

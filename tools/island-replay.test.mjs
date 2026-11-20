// Tests for the session replay tool: `node --test tools/island-replay.test.mjs`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { FIXTURE, codexRolloutPath, parseArgs, prepare } from './island-replay.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(ROOT, 'tools', 'island-replay.mjs');
const FIXTURES = join(ROOT, 'apps', 'desktop', 'src-tauri', 'island', 'tests', 'fixtures');
const NOW = Date.UTC(2026, 10, 21, 3, 0, 0);
const PID = 31337;

const lines = (agent) => readFileSync(join(FIXTURES, FIXTURE[agent]), 'utf8').split('\n').filter(Boolean);
const labels = (agent) => lines(agent).map((line) => prepare(agent, line, NOW, PID).label);

test('options: defaults, numbers and the checks each agent needs', () => {
  assert.deepEqual(parseArgs(['--agent', 'generic']), { agent: 'generic', pace: 2600, hold: 4000 });
  assert.equal(parseArgs(['--agent', 'opencode', '--pace', '0', '--hold', '10']).pace, 0);
  assert.throws(() => parseArgs(['--agent', 'aider']), /--agent must be one of/);
  assert.throws(() => parseArgs(['--agent', 'copilot']), /--hook/);
  assert.throws(() => parseArgs(['--agent', 'codex']), /--codex-home/);
  assert.throws(() => parseArgs(['--agent', 'generic', '--pace', 'fast']), /milliseconds/);
  assert.throws(() => parseArgs(['--agent', 'generic', '--pace']), /missing value/);
  assert.throws(() => parseArgs(['--agent', 'generic', '--speed', '2']), /unknown option/);
  assert.throws(() => parseArgs(['--agent', 'generic', '--shots', 'out']), /--prefix/);
});

test('codex rollouts land where Codex writes them, named so the island reads the session id', () => {
  const path = codexRolloutPath('C:\\codex', new Date(2026, 0, 5, 9));
  assert.equal(path, join('C:\\codex', 'sessions', '2026', '01', '05', 'rollout-2026-01-05T00-00-00-01a04e65-47c8-70c1-b898-8d5452cb24b0.jsonl'));
});

test('every recorded line is moved to now; the lines the island skips are still sent but never captured', () => {
  const codex = lines('codex').map((line) => prepare('codex', line, NOW, PID));
  for (const item of codex.filter((i) => i.label)) assert.equal(JSON.parse(item.raw).timestamp, new Date(NOW).toISOString());
  const started = codex.find((i) => i.label === 'task-started');
  assert.equal(JSON.parse(started.raw).payload.started_at, NOW / 1000);
  assert.ok(codex.some((i) => i.label === null && i.raw.startsWith('not a json line')));

  const opencode = lines('opencode').map((line) => prepare('opencode', line, NOW, PID)).filter((i) => i.label);
  for (const item of opencode) {
    const v = JSON.parse(item.raw);
    assert.equal(v.event.created, NOW);
    assert.equal(v.pid, PID, 'the session stops when the replay process exits');
  }

  const generic = lines('generic').map((line) => prepare('generic', line, NOW, PID));
  const first = JSON.parse(generic[0].raw);
  assert.equal(first.at, NOW);
  assert.equal(first.pid, PID);
});

test('the generic replay captures exactly the states the island shows, and skips what it skips', () => {
  assert.deepEqual(labels('generic'), [
    'thinking', 'reading', 'searching', 'tokens',
    null, // unknown phase "teleporting"
    null, // protocol version 2
    null, // cut-off line
    'editing', 'waiting', 'running', 'tokens', 'done',
  ]);
});

test('copilot lines carry their event name for the hook, and a line without a session is not captured', () => {
  const items = lines('copilot').map((line) => prepare('copilot', line, NOW, PID));
  const read = items.find((i) => i.event === 'preToolUse');
  assert.equal(JSON.parse(read.raw).timestamp, NOW);
  assert.equal(read.label, 'pre-tool-use');
  assert.ok(items.some((i) => i.event === 'preToolUse' && !JSON.parse(i.raw).sessionId && i.label === null));
  assert.ok(items.some((i) => i.event === undefined && i.label === null), 'the non-json line is skipped');
});

test('a full generic replay appends every line to the feed folder, with the times of the replay', () => {
  const home = mkdtempSync(join(tmpdir(), 'island-replay-'));
  try {
    const before = Date.now();
    const run = spawnSync(process.execPath, [TOOL, '--agent', 'generic', '--pace', '0', '--hold', '0'], {
      env: { ...process.env, LOCALAPPDATA: home },
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    const feed = join(home, 'dev.dotdock.desktop', 'agents');
    assert.deepEqual(readdirSync(feed), ['generic-replay.jsonl']);
    const written = readFileSync(join(feed, 'generic-replay.jsonl'), 'utf8').split('\n').filter(Boolean);
    assert.equal(written.length, lines('generic').length);
    const first = JSON.parse(written[0]);
    assert.ok(first.at >= before && first.at <= Date.now());
    assert.notEqual(first.pid, 5150, 'the recorded pid is replaced by the replay process');
    assert.match(run.stdout, /holding for 0 ms/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a codex replay writes a rollout under the given codex home', () => {
  const home = mkdtempSync(join(tmpdir(), 'island-replay-codex-'));
  try {
    const run = spawnSync(process.execPath, [TOOL, '--agent', 'codex', '--codex-home', home, '--pace', '0', '--hold', '0'], {
      env: { ...process.env, LOCALAPPDATA: home },
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    const written = readFileSync(codexRolloutPath(home, new Date()), 'utf8').split('\n').filter(Boolean);
    assert.equal(written.length, lines('codex').length);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

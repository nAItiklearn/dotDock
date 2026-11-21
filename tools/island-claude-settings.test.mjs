// Tests for the live-test hook settings: `node --test tools/island-claude-settings.test.mjs`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { EVENTS, hookSettings } from './island-claude-settings.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONNECT = readFileSync(join(ROOT, 'apps', 'desktop', 'src-tauri', 'island', 'src', 'connect.rs'), 'utf8');

test('the events and matchers are the ones Connect registers', () => {
  const block = CONNECT.match(/const EVENTS: \[[^\]]*\] = \[([\s\S]*?)\];/)[1];
  const rust = [...block.matchAll(/\("(\w+)", (None|Some\("([^"]*)"\))\)/g)].map((m) => [m[1], m[3] ?? null]);
  assert.deepEqual(EVENTS, rust);
});

test('every event runs our hook asynchronously, with forward slashes like Connect writes', () => {
  const { hooks } = hookSettings(String.raw`D:\dd\target\debug\dotdock-island-hook.exe`);
  assert.deepEqual(Object.keys(hooks), EVENTS.map(([e]) => e));
  for (const [event, matcher] of EVENTS) {
    const [group] = hooks[event];
    assert.equal(group.matcher, matcher ?? undefined);
    assert.deepEqual(group.hooks, [{ type: 'command', command: 'D:/dd/target/debug/dotdock-island-hook.exe', args: [], async: true }]);
  }
});

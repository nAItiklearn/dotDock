#!/usr/bin/env node
// Writes a Claude Code settings file that registers the island's hook, for a live test with a real session
// without touching the user's own ~/.claude/settings.json:
//
//   node tools/island-claude-settings.mjs --hook <dotdock-island-hook.exe> --out <file>
//   claude -p "<task>" --settings <file>
//
// The entries are the ones Connect writes (apps/desktop/src-tauri/island/src/connect.rs, EVENTS), so the session
// reaches the island exactly as a connected one does. `--settings` adds to the user's settings for that one run.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/// Mirrors EVENTS in connect.rs: the events the island listens to, with the matcher each needs.
export const EVENTS = [
  ['UserPromptSubmit', null],
  ['PreToolUse', null],
  ['PostToolUse', null],
  ['PostToolUseFailure', null],
  ['Stop', null],
  ['StopFailure', null],
  ['SessionEnd', null],
  ['Notification', 'idle_prompt|permission_prompt|agent_needs_input'],
];

export function hookSettings(hook) {
  const entry = { type: 'command', command: hook.replaceAll('\\', '/'), args: [], async: true };
  const hooks = {};
  for (const [event, matcher] of EVENTS) hooks[event] = [{ ...(matcher ? { matcher } : {}), hooks: [entry] }];
  return { hooks };
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0 || !argv[i + 1]) throw new Error(`--${name} <path> is required`);
    return resolve(argv[i + 1]);
  };
  const out = opt('out');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(hookSettings(opt('hook')), null, 2)}\n`);
  console.log(out);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

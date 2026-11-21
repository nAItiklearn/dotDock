// Hard live test for the running island: a burst of agent feed events, with malformed lines mixed in.
//   node tools/capture/island-burst.mjs [events] [sessions]
// Appends `events` lines (default 1000) for `sessions` sessions (default 10) to the feed folder as fast as Node
// can write them, one write per line as a real agent does, every tenth line garbage of a different kind. Each
// session ends on "running" with its own token count, so the island must show that state and count for each,
// and when this process exits every session must turn to Stopped (a crashed agent). Prints what it wrote.

import { appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [events = '1000', sessions = '10'] = process.argv.slice(2);
const total = Number(events);
const count = Number(sessions);
const dir = join(process.env.LOCALAPPDATA ?? '', 'dev.dotdock.desktop', 'agents');
const file = join(dir, `burst-${process.pid}.jsonl`);
const PHASES = ['thinking', 'reading', 'searching', 'editing', 'running'];
const GARBAGE = [
  '\u0000\u00ff not json',
  '{"agent":"burst","session":"s0","phase":"teleporting"}',
  '{"agent":"burst","session":"s0","phase":"running","tokens_out":"many"}',
  `{"agent":"burst","session":"s0","detail":"${'x'.repeat(40_000)}"}`,
  '{"v":2,"agent":"burst","session":"s0","phase":"done"}',
  '[1,2,3]',
  '{"agent":"burst","session":"s0","phase":"running"',
];
/// How long to stay alive after the burst, so the island is seen working before the "crash".
const HOLD_MS = 6000;

mkdirSync(dir, { recursive: true });
rmSync(file, { force: true });
const started = performance.now();
let garbage = 0;
let valid = 0;
const validTotal = total - Math.floor(total / 10);
for (let i = 0; i < total; i++) {
  if (i % 10 === 9) {
    appendFileSync(file, `${GARBAGE[garbage++ % GARBAGE.length]}\n`);
    continue;
  }
  const s = valid % count;
  const phase = valid >= validTotal - count ? 'running' : PHASES[valid % PHASES.length];
  const line = { v: 1, agent: 'burst', name: 'Burst', session: `s${s}`, at: Date.now(), phase, tool: 'shell', detail: `step ${valid}`, tokens_out: valid, pid: process.pid, cwd: 'D:\\dotDock' };
  appendFileSync(file, `${JSON.stringify(line)}\n`);
  valid++;
}
console.log(JSON.stringify({ file, lines: total, garbage, sessions: count, writeMs: +(performance.now() - started).toFixed(1) }));
setTimeout(() => process.exit(0), HOLD_MS);

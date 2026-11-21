#!/usr/bin/env bash
# The whole live notch run in one go, so it holds the screen for minutes, not an afternoon:
#   bash tools/capture/island-live-run.sh
# Every state over Wind Meadow (for the website), every agent's replay, frame pacing while the island works, the
# burst-and-crash test, idle CPU, and a real Claude Code session. Results go to docs/QA/notch-live/run3 and
# docs/QA/notch-live/website; numbers to .cache/live/*.json. Exits without touching the screen when another
# track holds it (D-033). Steps to skip can be named in SKIP, for example SKIP="states codex".
set -u
SKIP=${SKIP:-}
want() { [[ " $SKIP " != *" $1 "* ]]; }
source "$(dirname "${BASH_SOURCE[0]}")/island-live.sh"
RUN=$WT/docs/QA/notch-live/run3
WEB=$WT/docs/QA/notch-live/website
CLAUDE_TASK=$LIVE/claude-task
# Seconds to wait for the island page to appear on the DevTools port after start.
READY_S=120
mkdir -p "$RUN" "$WEB" "$CLAUDE_TASK"
log() { echo "$(date +%T) $*"; }

live_begin || exit 1
trap live_end EXIT
for _ in $(seq "$READY_S"); do
  curl -s "http://127.0.0.1:$DEBUG_PORT/json" | grep -q island.html && break
  sleep 1
done
log "island up"
ps_ -Command "(New-Object -ComObject WScript.Shell).AppActivate('dotDock test backdrop')" > /dev/null
APP=$(ps_ -Command "(Get-CimInstance Win32_Process -Filter \"Name='dotdock.exe'\" | ? { \$_.ExecutablePath -like '$WTW/*'.Replace('/', '\\') }).ProcessId")

if want states; then
log "every state"
replay states --pace 2200 --hold 2500 --shots "$(cygpath -w "$WEB")" --prefix 1 --crop "$CROP" > "$LIVE/replay-states.log" 2>&1
fi

for agent in codex copilot opencode generic; do
  want "$agent" || continue
  log "replay $agent, frame pacing alongside"
  frames 20 > "$LIVE/frames-$agent.json" 2>&1 &
  pacing=$!
  replay "$agent" --pace 1500 --hold 2000 --shots "$(cygpath -w "$RUN")" --prefix "6$agent" --crop "$CROP" > "$LIVE/replay-$agent.log" 2>&1
  # Only this step's jobs: a bare wait would also wait for the backdrop started by live_begin.
  wait "$pacing"
done

log "burst of 1000 with garbage, then a crash"
frames 15 > "$LIVE/frames-burst.json" 2>&1 &
pacing=$!
node "$WT/tools/capture/island-burst.mjs" 1000 10 > "$LIVE/burst.json"
crop 70-burst-running
wait "$pacing"
sleep 2
crop 71-burst-crashed-stopped

log "real Claude Code session"
node "$WT/tools/island-claude-settings.mjs" --hook "$HOOK" --out "$(cygpath -w "$LIVE/claude-hooks.json")" > /dev/null
printf 'The island shows what an AI coding agent is doing, read from local files only.\n' > "$CLAUDE_TASK/notes.txt"
frames 20 > "$LIVE/frames-claude.json" 2>&1 &
pacing=$!
ps_ -File "$WT/tools/capture/sequence.ps1" -Dir "$(cygpath -w "$LIVE/claude-seq")" -Prefix claude -Crop "$CROP" -Every 1500 -Seconds 45 > "$LIVE/claude-seq.log" 2>&1 &
sequence=$!
(cd "$CLAUDE_TASK" && claude -p "Read notes.txt, write a one-sentence summary of it to summary.txt, then run dir and tell me how many files there are." \
  --settings "$(cygpath -w "$LIVE/claude-hooks.json")" --allowedTools "Read,Write,Bash(dir)" > "$LIVE/claude-out.txt" 2>&1)
wait "$pacing" "$sequence"

log "idle"
sleep 8
crop 90-standby-after
ps_ -File "$WT/tools/capture/idle-cpu.ps1" -Id "$APP" -Seconds 60 > "$LIVE/idle-after.json" 2>&1
log "done"

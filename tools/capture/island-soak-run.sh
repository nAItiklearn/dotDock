#!/usr/bin/env bash
# The hard live test of the notch in one go, on the real desktop over Wind Meadow:
#   bash tools/capture/island-soak-run.sh            (SECS=180 SEED=1 IDLE=60 by default)
# Frame pacing at rest first (the machine's own baseline), then tools/capture/island-soak.mjs (random agent events
# and real mouse input at once, every few seconds a screenshot of the island), then idle CPU and idle frame
# pacing once the island is back in standby. Results go to docs/QA/notch-live/soak. Exits without touching the
# screen while another track holds it (D-033). Exit code is the soak's: 0 only when it passed.
set -u
source "$(dirname "${BASH_SOURCE[0]}")/island-live.sh"
SECS=${SECS:-180}
SEED=${SEED:-1}
IDLE=${IDLE:-60}
OUT=${OUT:-$WT/docs/QA/notch-live/soak}
SHOTS=$OUT
# Seconds to wait for the island page to appear on the DevTools port after start, then for it to settle.
READY_S=120
SETTLE_S=4
# Screenshot period during the soak, ms.
SHOT_EVERY_MS=6000
mkdir -p "$OUT"
log() { echo "$(date +%T) $*"; }

live_begin || exit 1
trap live_end EXIT
for _ in $(seq "$READY_S"); do
  curl -s "http://127.0.0.1:$DEBUG_PORT/json" | grep -q "localhost:$DEV_PORT/island.html" && break
  sleep 1
done
if ! curl -s "http://127.0.0.1:$DEBUG_PORT/json" | grep -q "localhost:$DEV_PORT/island.html"; then
  log "the island page is not this worktree's (build with build_app first); stopping"
  exit 1
fi
sleep "$SETTLE_S"
ps_ -Command "(New-Object -ComObject WScript.Shell).AppActivate('dotDock test backdrop')" > /dev/null
APP=$(ps_ -Command "(Get-CimInstance Win32_Process -Filter \"Name='dotdock.exe'\" | ? { \$_.ExecutablePath -like '$WTW/*'.Replace('/', '\\') }).ProcessId")
log "island up (pid $APP, $FRONTEND build), baseline"
frames 10 > "$OUT/frames-baseline.json"
log "soak ${SECS}s, seed $SEED"
ps_ -File "$WT/tools/capture/sequence.ps1" -Dir "$(cygpath -w "$OUT")" -Prefix soak -Crop "$CROP" -Every "$SHOT_EVERY_MS" -Seconds "$SECS" > "$LIVE/soak-seq.log" 2>&1 &
sequence=$!
soak "$SECS" "$SEED" > "$OUT/report.json" 2> "$LIVE/soak.err"
result=$?
wait "$sequence"
log "soak exit $result; idle"
crop soak-after-standby
ps_ -File "$WT/tools/capture/idle-cpu.ps1" -Id "$APP" -Seconds "$IDLE" > "$OUT/idle-cpu.json" 2>&1
frames 10 > "$OUT/frames-idle.json"
log "done"
exit "$result"

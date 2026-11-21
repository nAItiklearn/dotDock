# Live notch run on the real desktop. Source me from Git Bash, then call the functions below.
#
#   live_begin        take the screen (D:\dotDock\.claude\screen.lock), refuse while another track holds it or
#                     another copy of dotDock runs, then start vite, the Wind Meadow backdrop and this app
#   replay <agent> …  play a recorded session (tools/island-replay.mjs) onto the island
#   shot <name> [crop] / crop <name>   screenshot into $SHOTS
#   frames <seconds>  frame pacing of the island page (tools/capture/island-frames.mjs)
#   live_end          stop everything this file started and give the screen back
#
# Only one dotDock may run per user (the single-instance plugin), so the notch run never starts while another
# track's dotdock.exe runs, and live_end always stops its own one (D-033).

WT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
WTW=$(cd "$WT" && pwd -W)
LIVE=$WT/.cache/live
SHOTS=${SHOTS:-$WT/docs/QA/notch-live}
EXE=$WTW/.cache/target/debug/dotdock.exe
HOOK=$WTW/.cache/target/debug/dotdock-island-hook.exe
LOCK=/d/dotDock/.claude/screen.lock
TRACK=notch
# The island's part of a 1920 px wide primary screen.
CROP=${CROP:-635,0,650,300}
# A private DevTools port, so another track's capture tool never attaches to this app.
DEBUG_PORT=47913
# A private dev-server port. Every track's debug build loads its pages from localhost:1420 by default, so with
# another track's vite on 1420 this app would show that track's code. The notch build is compiled with this port
# instead (see build_app), and live_begin checks the island page really comes from it.
DEV_PORT=1424
# What serves the pages on DEV_PORT: "preview" (default) is the production build, so frame timings measure the
# React and motion code that ships; "dev" is vite's dev server (development React in StrictMode, several times
# slower per render), for debugging only.
FRONTEND=${FRONTEND:-preview}

# Builds the debug app and hook for the live run, with the island's pages served from DEV_PORT.
build_app() {
  (cd "$WT/apps/desktop/src-tauri" && source "$WT/tools/env-gnu.sh" && CARGO_TARGET_DIR="$WT/.cache/target" \
    TAURI_CONFIG="{\"build\":{\"devUrl\":\"http://localhost:$DEV_PORT\"}}" \
    cargo +stable-x86_64-pc-windows-gnu build -p dotdock -p dotdock-island-hook)
}
# Another track's lock older than this is abandoned (docs/AGENT_RULES.md: a run holds the screen 20 min at most).
LOCK_STALE_S=1200

mkdir -p "$LIVE" "$SHOTS"

ps_() { powershell -NoProfile -ExecutionPolicy Bypass "$@"; }

# Ids of dotdock.exe processes that are not this worktree's build.
other_dotdock() {
  ps_ -Command "Get-CimInstance Win32_Process -Filter \"Name='dotdock.exe'\" | ? { \$_.ExecutablePath -notlike '$WTW/*'.Replace('/', '\\') } | % { \$_.ProcessId }"
}

live_begin() {
  if [ -f "$LOCK" ]; then
    local age=$(( $(date +%s) - $(stat -c %Y "$LOCK") ))
    if ! grep -q "^$TRACK " "$LOCK" && [ "$age" -lt "$LOCK_STALE_S" ]; then
      echo "screen held: $(cat "$LOCK") (${age}s ago)"; return 1
    fi
  fi
  local others; others=$(other_dotdock)
  if [ -n "$others" ]; then echo "another dotdock.exe runs (pid $others); not starting"; return 1; fi
  if curl -s -o /dev/null "http://localhost:$DEV_PORT/"; then echo "port $DEV_PORT already serves something; not starting"; return 1; fi
  echo "$TRACK $(date -Iseconds)" > "$LOCK"
  if [ "$FRONTEND" = preview ]; then
    (cd "$WT/apps/desktop" && npx vite build > "$LIVE/vite-build.log" 2>&1) || { echo "vite build failed"; rm -f "$LOCK"; return 1; }
    (cd "$WT/apps/desktop" && nohup npx vite preview --port "$DEV_PORT" --strictPort > "$LIVE/vite.log" 2>&1 &)
  else
    (cd "$WT/apps/desktop" && nohup npx vite --port "$DEV_PORT" --strictPort > "$LIVE/vite.log" 2>&1 &)
  fi
  nohup powershell -NoProfile -ExecutionPolicy Bypass -File "$WT/tools/capture/backdrop.ps1" \
    -Image "$WTW/assets/wallpapers/meadow-dots-dark.jpg" -Seconds "$LOCK_STALE_S" > "$LIVE/backdrop.log" 2>&1 &
  (cd "$LIVE" && CODEX_HOME=$(cygpath -w "$LIVE/codex-home") \
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=$DEBUG_PORT nohup "$EXE" > "$LIVE/app.log" 2>&1 &)
}

shot() { ps_ -File "$WT/tools/capture/screenshot.ps1" -Out "$SHOTS/$1.png" ${2:+-Crop $2}; }
crop() { shot "$1" "$CROP"; }
frames() { node "$WT/tools/capture/island-frames.mjs" "$DEBUG_PORT" "${1:-10}"; }
replay() { node "$WT/tools/island-replay.mjs" --agent "$1" --hook "$HOOK" --codex-home "$(cygpath -w "$LIVE/codex-home")" "${@:2}"; }

live_end() {
  ps_ -Command "Get-CimInstance Win32_Process | ? { \$_.CommandLine -like '*$(basename "$WT")*' -and (\$_.Name -eq 'dotdock.exe' -or \$_.Name -eq 'node.exe' -or (\$_.Name -eq 'powershell.exe' -and \$_.CommandLine -like '*backdrop.ps1*')) } | % { Stop-Process -Id \$_.ProcessId -Force; \$_.ProcessId }"
  if [ -f "$LOCK" ] && grep -q "^$TRACK " "$LOCK"; then rm -f "$LOCK"; fi
}

# Random agent events and real mouse input at once for <seconds> (tools/capture/island-soak.mjs); fails on errors,
# dropped frames or a stuck island.
soak() { node "$WT/tools/capture/island-soak.mjs" "$DEBUG_PORT" "${1:-180}" "${2:-1}"; }

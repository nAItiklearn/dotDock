# Hackatime status

How time for this project reaches Hackatime, what went wrong, and what was changed. The API key is
never printed, logged or committed.

## Rules (Hack Club)
- Only real activity is recorded. No heartbeat is ever generated, back-filled, replayed or scripted.
- Time that was not recorded is lost; it is not added back by any means.
- Every heartbeat sent from Claude Code sessions is tagged `category: ai coding`, so the dashboard
  shows honestly that the time came from an AI-assisted session.

## How time is recorded
| Source | What it sends |
|---|---|
| Editor extension (VS Code) | Heartbeats for files open in the editor. |
| `tools/hackatime/heartbeat.mjs` (Claude Code `PostToolUse` hook, `.claude/settings.json`) | One heartbeat per file a tool really read or edited (`Read`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit`), through the official `wakatime-cli`. Shell commands send nothing. |

The CLI applies its own rate limit (`heartbeat_rate_limit_seconds = 30` in `~/.wakatime.cfg`) and offline queue.

## Setup check (read only, 2026-11-19)
| Check | Result |
|---|---|
| `%USERPROFILE%\.wakatime.cfg` exists | pass |
| `api_url` set | pass (`hackatime.hackclub.com`) |
| `api_key` set | pass |
| `%USERPROFILE%\.wakatime\` exists | pass |

## Incident 2026-11-19: no time recorded from about 18:06 to 21:27
- **Symptom:** the dashboard stayed at 6 h 40 min for about two hours of work.
- **Evidence:** `heartbeats_last_sent_at` in `~/.wakatime/wakatime-internal.cfg` stayed at 18:06 and the
  offline queue was empty, so heartbeats were not failing to send: they were never created.
- **Cause:** the hook started `wakatime-cli` without waiting for it (`spawn` + `unref`) and exited at
  once. The CLI was ended together with the hook's process tree before it could send. The first trace
  after the fix shows this directly: a run with the old behaviour ended `exit=null` (killed).
- **Fix (commit `b0b8af0`):**
  - `heartbeat.mjs` waits for the CLI to finish, with a 20 s cap (`CLI_TIMEOUT_MS`).
  - The hook is registered with `"async": true` and `"timeout": 30`, so Claude Code never waits on it.
  - Each attempt appends one line (time, tool, CLI exit code) to `%LOCALAPPDATA%\dockDock\hackatime-hook.log`,
    so a silent failure is visible. The line never contains the key or the file contents.
- **Verified:** after the fix the CLI exited `0`, `heartbeats_last_sent_at` moved to 21:27:39 and the
  dashboard went from 6 h 40 min to 6 h 42 min.
- **Not done, on purpose:** the roughly two hours that were not recorded were not back-filled.

## Earlier change (commit `8132d6b`)
The CLI used to be started `detached`, which on Windows opened a console window on every tool call.
It was changed to a hidden, non-detached child. That stopped the flashing; the incident above showed
it also needed to be waited for.

## How to check it yourself
- `~/.wakatime/wakatime-cli-windows-amd64.exe --today` prints today's total.
- `~/.wakatime/wakatime-cli-windows-amd64.exe --offline-count` should be `0` when online.
- `%LOCALAPPDATA%\dockDock\hackatime-hook.log` should show `exit=0` lines while you work.

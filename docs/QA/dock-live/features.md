# Dock features, live on the real desktop

Each row is one feature, driven with real mouse and keys at a human pace on the real desktop, over the Wind Meadow
wallpaper in the Glass look, with a screenshot. Script: `tools/dock-tests/hard-test.ps1`.

## Run 2026-11-21T18:07:49

| # | Feature | Result | Evidence | Screen |
|---|---|---|---|---|
| 1 | Start guard: transparent outside the bar, click-through, no focus taken | FAIL | The dock draws its bar | PASS | drawn within 12,441 ms of the process start; Nothing outside the bar changed on screen (no opaque or white sheet) | FAIL | 98.38% of the screen outside the bar changed; Points away from the bar belong to the windows below, not the dock | PASS | 0 of 4 points hit the dock; The dock did not take the foreground | PASS | foreground: WindowsTerminal '? Claude Code' | [01.png](features/01.png) |
| 2 | Run stopped | FAIL | the start guard failed, so no input is sent to the dock | [02.png](features/02.png) |

2 of 2 rows failed.

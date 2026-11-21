# Theme track: timings, reviewer B and score (2026-11-21)

## Live run on the desktop
`live-run.log` and captures 20 to 36: three wallpapers (meadow dots, paper ring, soft mono), each turned into a
theme with preview, apply and undo; then the dotDock theme switched off (the owner's own wallpaper and taskbar
came back, `33-theme-off-screen.png`) and on again (dotDock's last wallpaper back, `35-theme-on-screen.png`).
First-run Wind Meadow default: `first-run-e2e.txt`, all checks pass.

The second live run for timings could not take the screen: the notch track's `dotdock.exe` (same app
identifier, so the single-instance guard forwards a second launch to it) and its dev server on port 1420 were
running for the whole window. The timings below were therefore taken in headless Chrome (same Blink engine as
WebView2) against this branch's dev server, with `?native=mock`. They are not app-process numbers.

## Theme switch frame timings (`perf-frames-settings.json`, `perf-frames.json`)
Apply a wallpaper theme, wait, undo, wait; three cycles per run, rAF deltas recorded in the page in front.

| Page | Cycle | Frames | Mean | p99 | Max | Dropped (> 25 ms) |
|---|---|---|---|---|---|---|
| Settings | 1 (first switch after load) | 146 | 17.7 ms | 33.1 ms | 150 ms | 2 |
| Settings | 2 | 155 | 16.7 ms | 17.4 ms | 17.6 ms | 0 |
| Settings | 3 | 155 | 16.8 ms | 16.8 ms | 33.4 ms | 1 |
| Settings, two more runs | 1 / 2 / 3 | | | | 42.0 / 16.8 / 17.3 ms; 33.4 / 16.8 / 17.4 ms | 1 / 0 / 0; 2 / 0 / 0 |
| Overlay (widgets) | 1 to 3 | 298 each | 16.66 ms | 17.1 ms | 17.6 ms | 0 |

A CPU profile of the first apply (`.claude-tmp/prof.mjs`) shows under 5 ms of script in the click; the rest of
the 92 ms to paint is native style recalculation and software painting of the whole Settings page when the
root colour variables change, in a dev build without GPU raster. Warm switches hold 60 fps. The first switch
after a page load drops one or two frames in this environment; it must be re-measured in the app (GPU
WebView2, production bundle) before it is called a regression.

## Idle (`idle-pages.json`, 60 s, nothing touched)
| Page | Main-thread busy | Script | Layouts | Style recalcs |
|---|---|---|---|---|
| Overlay (widgets) | 8 ms, 0.013 % of one core | 7 ms | 0 | 0 |
| Settings, Appearance page | 140 ms, 0.234 % of one core | 15 ms | 3 | 67 |

No DOM mutations and no running animations in Settings while idle; the recalcs follow the focused page title
(focus ring and caret painting) in a React dev build. Settings is opened on demand and closed afterwards; the
always-on overlay is well under the 0.2 % target. App-process idle CPU (the `dotdock.exe` and WebView2 tree)
is still to be measured on the real app when the screen is free; `.claude-tmp/perf.mjs` does it.

## Reviewer B
- Round 1 (earlier agent): AA on cards over the wallpaper, a duplicate "Use this desktop" switch, restore
  unreachable when the startup state fails. Fixed in 179804d, verified by round 2.
- Round 2 (fresh, Opus): 4.1. Found the user's own wallpaper lost on a second off, a dead-end launch with the
  theme off, a home-screen gate race, a half-switched "on" on a failed save, hand-over problems dropped on the
  next event and a repeated off re-restoring, a restore button that bypassed the switch with wrong text, a
  permanent notch warning without Claude Code, and a no-op filter. All fixed in a969f8f (D-026), with tests
  (`handover.rs` three new cycle tests, `StartupPage.test.tsx`).

## Score after the fixes (rubric, this track)
| Area | Score |
|---|---|
| Correctness | 4.8 |
| Robustness | 4.8 |
| Code quality | 4.8 |
| Test coverage | 4.7 |
| Looks (theme from wallpaper, switches; live captures) | 4.8 |
| Smoothness (warm 60 fps, first switch to re-measure in app) | 4.6 |
| **Average** | **4.75** |

# Dock benchmark: dotDock vs the macOS Dock vs CoolDock

The dock is scored against both at every milestone from D3 on (`docs/DOCK_SPEC.md`). A row counts as
"beaten" only when it is measured, not estimated. No Mac is available, so the macOS Dock and CoolDock
columns come from observed behaviour (the owner's videos, frame by frame at 30 fps, and public
material); dotDock's column is measured on this laptop (1920 x 1080 at 125 %, release build).

## 1. Feel (motion and response)
| Behaviour | macOS Dock | CoolDock | dotDock target |
|---|---|---|---|
| Hover magnification | Smooth cosine falloff over about 3 icons; follows the cursor continuously | No magnification seen | Continuous falloff driven by cursor x every frame, transform only; user can turn it off |
| Settle after the cursor leaves | Eases back in about 0.2 s, no overshoot | n/a | Critically damped spring, no overshoot, under 250 ms |
| Launch feedback | Icon bounces until the app opens | Not shown | One soft dot-matrix pulse plus the running dot appearing; no repeated bounce |
| Folder or stack opening | Fan, grid or list popover, scales from the icon | Popover grid fades and lifts | Grid grows out of the stack tile (shared-element transition), under 220 ms |
| Popover close | Instant fade | Fade | Reverse of opening, under 160 ms; Esc and click-away both close |
| Reorder by drag | Neighbours slide apart | Not shown | Neighbours slide on springs; drop lands without a jump |
| Window minimise | Genie or scale into the icon | n/a (macOS handles it) | Native Windows animation kept; the dock only updates indicators |

## 2. Performance (measured, release build)
| Metric | Target to beat both | How it is measured |
|---|---|---|
| Frame time during magnification and stack open | p95 under 8.3 ms (120 Hz safe), no dropped frame at 60 Hz | Chrome DevTools performance trace of the dock WebView, 10 s sweeps |
| Hover-to-first-movement latency | Under one frame after the pointer event | Trace: input event to the next composited frame |
| Click-to-launch (dock action only) | `ShellExecute` called under 30 ms after the click | Timestamps in `boot.log`-style dock log |
| Idle CPU with the dock visible | Under 0.3 % of one core | Task Manager / `GetProcessTimes` over 60 s |
| Idle wake-ups | No timers while nothing changes; the clock tile ticks once a minute | ETW or a 60 s trace |
| Memory | Not a priority (CLAUDE.md), recorded only | Working set |
| Cold start to dock visible | Under 1 s from process start, taskbar hidden in the same frame the dock appears | Boot stage marks |

## 3. Quality (visual and functional)
| Area | macOS Dock | CoolDock | dotDock target |
|---|---|---|---|
| Icon sharpness | Native vector or 1024 px icons | macOS icons | 256 px from the shell image factory, rendered at device pixels, never upscaled |
| Design language | System glass | Generic glass widget cards | Dot-matrix tiles matching the home screen, island and three themes |
| Finding an app | Scan a row or open Launchpad | Manual folders | Automatic category stacks plus App Library search |
| New apps | Appear in Launchpad, not filed | Not filed | Filed into a category on install |
| Running windows | Dots, right-click window list | Relies on the macOS Dock | Dots, focus accent, live thumbnails, window menu |
| Replaces the system bar | Is the system bar | No, runs beside it | Yes: hides the Windows taskbar and takes its work area |
| Live tiles | None | Many (87 widgets) | Fewer, each 4.5 or more on the rubric |
| Safety | n/a | n/a | Taskbar restored on every exit path (DOCK_SPEC section 3) |
| Price | Built in | EUR 15 to 50 | Free, open source |

## 4. Scoring
Each milestone fills a results table below: one row per benchmark item, the measured value, and a
verdict of **beats**, **matches** or **behind**. Any "behind" in sections 1 or 2 blocks the milestone
unless the reason is logged in `docs/DECISIONS.md`. The rubric score (4.5 bar) is recorded beside it.

## 5. Results
None yet: the first measurements come with milestone D3 (the dock bar, stacks and magnification).

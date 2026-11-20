# v2 test plan (owner order, 2026-11-20)

Nothing is called done, and v2 is not released, until every phase below has passed in this order.
Each phase records results (date, what was done, measured numbers, pass/fail, fixes) in `docs/QA/`.
"Hard test" means: real data on this laptop, every control used, edge cases, slow-machine mode
(6x CPU throttle), and lag measured against `docs/design/DOCK_BENCHMARK.md`.

## Phase 1: every dock feature, first and second wave
- Every row of `docs/dock/FEATURE_PARITY.md`, one by one: its acceptance test, plus
  - empty state, error state, permission or device missing, outside changes (e.g. volume changed from the keyboard),
  - restart persistence, three themes, lite effects mode,
  - lag: input to visible, command round trip, idle CPU with the tile on screen.
- Taskbar replacement: dock on, taskbar hidden, every exit path restores it (`tools/test-taskbar-restore.cmd`),
  Explorer restart, lock/unlock, display off, fullscreen game, sleep, two monitors, DPI change.
- Report: `docs/QA/V2_DOCK_FEATURES.md`.

## Phase 2: every notch feature, with any AI agent
- Every state and every small detail is accurate against what the agent really did: phase, file or
  command shown, token count, elapsed time, project name, Done summary, Needs-you prompt, errors
  (signed out, offline, busy, model, limit with reset time), pager, click to focus the right terminal,
  dismiss, move aside, idle modes, sounds, settings, Connect/Disconnect restoring settings byte for byte.
- Agents: Claude Code, Codex, and every other agent the island supports (see `docs/ISLAND_AGENTS.md`),
  each driven by a real session on this laptop where the agent is installed.
- Report: `docs/QA/V2_NOTCH.md`.

## Phase 3: the whole environment (home screen, dock, notch together)
- Add, move, resize, duplicate and remove every widget and tile; snapping, collisions, undo/redo,
  profiles, themes, wallpapers, multi-monitor; long sessions (8 h soak with memory and CPU logged);
  restart and cold boot; safe mode; restore to stock Windows and back.
- Report: `docs/QA/V2_ENVIRONMENT.md`.

## Phase 4: the website against cooldock.app, section by section
- Every page and section side by side with cooldock.app's equivalent (hero, feature sections, widget
  gallery, pricing/download, FAQ, footer, legal pages, mobile layouts), scored on the rubric for
  typography, layout, art, motion, clarity, honesty; plus Lighthouse (performance, accessibility, SEO,
  best practices) for both sites.
- Every section must score at least as high as CoolDock's; any section that does not is redone.
- Report: `docs/QA/V2_WEBSITE_VS_COOLDOCK.md`.

## Goal
Beat CoolDock's dock and website: measured, not claimed.

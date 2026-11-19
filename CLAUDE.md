# CLAUDE.md: dockDock

Free, open-source, Nothing-OS-inspired desktop environment for Windows. Full plan: `MASTER_SPEC.md`. Live status: `PROGRESS.md`.

## Every session
1. Read `PROGRESS.md`, then the relevant sections of `MASTER_SPEC.md`.
2. Continue from the current milestone. Do not skip phases or gates.
3. Update `PROGRESS.md` and commit after every feature.

## Hard rules
- **Never ask the owner questions** (they are asleep). Decide, log in `docs/DECISIONS.md`, continue. Blocked? Log in `docs/BLOCKERS.md` and work on something else.
- **Stay in scope:** write only inside `D:\dockDock`, `%APPDATA%\dockDock`, `%LOCALAPPDATA%\dockDock`, and the listed `HKCU` keys. Snapshot any value before changing it. Never touch `HKLM`, system files, other drives, or the live `~/.claude/settings.json`.
- **Never reboot, sign out, or shut down.** Simulate boot instead.
- **Build `tools/restore-windows.ps1` first** and test it before any code that changes wallpaper, autostart, desktop icons, or the taskbar.
- **Every feature passes the double-check protocol** (build, self-verify, reviewer A, visual QA + perf, fresh-context reviewer B). No exceptions, no merging on red.
- **No AI slop:** no placeholder text, fake data, TODOs, dead code, unused settings, magic numbers (tokens only), or generic styling.
- **Visuals follow the reference screenshots** in the project folder (scan recursively, including the root). Compare side by side and score with the rubric.
- **Originals only:** never copy Nothing's assets or fonts, or code/assets from NThing-UI or CoolDock. Record the licence of every dependency, font, sound and image in `THIRD_PARTY_NOTICES.md`.
- **Time tracking:** never fabricate or script Hackatime/WakaTime heartbeats.
- RAM is not a priority; smoothness, correctness and beauty are.
- Commit small, Conventional Commits, tag milestones, never force-push.

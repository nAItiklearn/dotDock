# Live status (rewritten every 30 min)

**2026-11-21 (new session): sequential mode, owner request.** One feature at a time: fresh Opus builder finishes it, a separate fresh Opus reviewer scores it, merge only at 4.8 or more (nothing under 4.5) with every check green, then the next feature. Order: Notch, Theme, Settings, Download page, Home screen, Dock (host + UI), Developer tiles, Website. Now running (owner asked for these in parallel, same rules): **Notch** builder; **Dock** builder (host + UI worktrees); **Website** builder (download page, then main site); **Checker** (independent reviewer B, starting with Theme). Shared screen: `D:\dotDock\.claude\screen.lock` must be held for any on-screen test (20 min max). Disk: reuse existing target dirs, stop under 12 GB.

**Last check:** 2026-11-21 15:25. **Disk D:** 17 GB free (limit 12 GB). **Screen:** free.
**Owner deadline (15:25): everything done in 4-6 hours.** Plan: notch, Settings, download page ready by 18:00; home screen 18:30; dock 19:30; whole-launcher run for the owner, then videos; website complete by 20:00, videos in at about 20:30; then auto-update, installer and deploy.

| Track | Working on now | Last commit | Flags |
|---|---|---|---|
| Dock host (real dock on the desktop) | Bottom-only done; DWM glass, taskbar parity, guarded hard test | 61 min ago | Due 19:30 |
| Dock UI | Categories, quality bar (39 files uncommitted) | 2 h ago | Pushed (2 of 2), due 19:30 |
| Notch | Live run 3 committed; hard test, reviewer B | 21 min ago | Due 18:00 |
| Theme + two switches | Reported 4.75: fresh reviewer B running now; real-app timings once the screen is free | a07f5f4 | Reviewing |
| Settings | Reopen-closes bug; startup_get/set wiring | 73 min ago | Due 18:00 |
| GitHub/dev tiles | Final report | 63 min ago | Merge first |
| Website | Bento features, carousel, audit (15 files uncommitted) | 26 min ago | Due 20:00 |
| Download page | Horse redraw, overlap check (16 files uncommitted) | 64 min ago | Due 18:00 |
| Home screen direct editing | Stuck selection, + Widgets, free move on the real desktop | 42 min ago | Due 18:30 |
| Photo widget | Merged into main (1b135f3), 4.83 | merged | Done |

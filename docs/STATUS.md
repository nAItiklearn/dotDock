# Live status (rewritten every 30 min)

**Last check:** 2026-11-21 07:07. **Disk D:** 19 GB free (limit 12 GB). **Screen:** dock host live run (lock since 07:01).

**Release gate the owner asked for (in order, nothing skipped):** live test of every dock feature, then every notch
feature, then every launcher/home-screen feature; then a whole-app check on the merged build that every planned
feature is present; then the website check (all features and details described, no overlap, all in theme); every
surface rated 4.8 or more. Only then deploy and release. No bugs from disk space or interruptions.

| Track | Working on now | Last commit | Flags |
|---|---|---|---|
| Dock host (real dock on the desktop) | **Live run on the owner's screen now.** Must show the real user path (add, remove, customise, every feature), pixel precision at 100/125/150 %, only working apps in the catalogue | 30 min ago | Top priority |
| Dock UI | Committed a perf harness that measures smoothness while an item is dragged and dropped back. Next: proof per feature, pixel-precision tests, user-path recordings | 27 min ago | |
| Notch | Committed the live-test drivers (real `claude -p` session, grass backdrop). Next: cute state animations, live run after the dock | 8 min ago | Back on track after push 1 |
| Theme + two switches | First-run test passes; live theme run done or pending reviewer B | 37 min ago | |
| Settings | Native commands, Dock section, new look | 44 min ago | |
| GitHub/dev tiles | Polish, live check, final review | 46 min ago | |
| Website | Drake/Travis photo widget, left-edge clipping fix, widgets grid, pixel scenes, Features page | 36 min ago | |
| Download page (new) | Branch set up; designing the new meadow scenery page | not yet | Fresh agent |
| Home screen direct editing (new) | Audit, then move/resize/delete/add straight from the desktop | not yet | Fresh agent |
| Photo widget | Merged into main (1b135f3), 4.83 | merged | Done |

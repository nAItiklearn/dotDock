# Dock research (2026-11-19)

Inspiration only. No code, art, icons or wording is taken from any of these products (spec 16).

## Sources studied
| Source | What it is |
|---|---|
| `overview-30fps.mp4` (owner, 90 s) | CoolDock product tour on macOS. |
| `threads-video-1 (1).mp4` (owner, 29 s) | A cluttered dock regrouped into category stacks. |
| `Screenshot 2026-11-19 210808.png` | CoolDock widget gallery over the dock. |
| `Screenshot 2026-11-19 211126.png` | LaunchMe dock with widgets beside apps. |
| launchmeapp.com, cooldock.app | Feature lists (read 2026-11-19). |

Contact sheets of both videos: `.cache/dock/v1/sheet.jpg`, `.cache/dock/v2/sheet.jpg` (not committed).

## What each does well
**Category stacks (threads video).** About forty loose icons become five or six stacks named Utilities,
Development, Comms and so on. A stack is one tile that previews its apps as a mini grid; clicking it
opens a tinted popover grid of that category, labelled with the category name. Ten seconds to find
anything instead of scanning a row. This is the owner's favourite feature.

**Live widget tiles (CoolDock).** The dock holds compact live tiles beside apps: clock, revenue,
stock spark line, focus timer, now playing, quick toggles, temperature. Each tile opens a rich popover
(Focus with work/break steppers, Quick Toggles list with per-toggle "show on dock", Drink Water
interval picker). A searchable, categorised widget gallery (87+ widgets) opens above the dock and
widgets are dragged in. An edit mode shows red remove badges on every tile.

**LaunchMe.** Full-screen launcher with search (files, calculator, emoji, clipboard history), smart
sorting that groups apps automatically, folder covers and colours, per-display docks, layouts saved as
switchable presets.

## Where they fall short (our openings)
- Both are macOS only and run *beside* the system dock. Windows users get nothing like either.
- CoolDock's dock gets long and busy; its widgets are generic glass cards, not a design language.
- Grouping in both is manual or a one-off sort; nothing keeps new installs filed automatically.
- Neither replaces the taskbar's jobs (running windows, window switching, tray, clock), so the old bar stays.
- Paid (CoolDock EUR 15 to 50; LaunchMe PRO subscription). Ours is free and open source.

## What dotDock's dock must do to beat them
1. **Replace the Windows taskbar for real**, with running-window indicators, click to restore or
   minimise, live thumbnails, and a guaranteed restore of the native taskbar on every exit path.
2. **Auto-filed category stacks**: every installed app (Start menu shortcuts and Store apps) is
   classified into a category on first run and on every new install, editable by drag. The App
   Library is the same categories, full screen, with instant search.
3. **One design language**: dot-matrix tiles that match the home screen, the three themes, the
   island. A dock that looks like it belongs to the desktop, not a widget pack.
4. **Live tiles, few and excellent** (each scored 4.5+) rather than 87 average ones.
5. **Smoothness first**: spring magnification and stack opening on the compositor, 120 Hz safe, no
   layout thrash, measured with the same perf gate as the home screen.
6. Free, open source, no account, no telemetry.

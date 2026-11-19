# Dock feature parity with CoolDock, and the acceptance test for each

Owner rule (2026-11-20): every dock feature must work, and the dock must have most of CoolDock's
features. Each row is accepted only when its test has been run on this laptop and passed; the result
and date go in the status column. Status: **planned**, **built**, **accepted**. Out-of-scope rows say why.

## Dock items
| CoolDock feature | dotDock | Acceptance test | Status |
|---|---|---|---|
| Favourite apps | Pinned apps | Pin, reorder by drag, unpin; survives restart | planned |
| App folders | Category stacks (filed automatically) + user stacks | New install appears in the right stack; drag app between stacks; rename and recolour a stack | planned |
| Favourite folders | Folder items (open in Explorer, stack preview of contents) | Add Downloads, open it, preview shows its newest files | planned |
| Bookmarks | Link items (open in the default browser) | Add a URL, click opens it | planned |
| Quick actions | Action items (run a shortcut, lock, sleep display, empty bin) | Each action runs once, with confirm where destructive | planned |
| Profiles | Dock profiles (Work, Home, Gaming), switch by shortcut, schedule or fullscreen game | Switch three ways; items and tiles change | planned |
| Floating layouts | Float vs reserve space, any edge, per monitor | Maximise a window in both modes; two monitors | planned |
| (not in CoolDock) Running windows | Dots, focus accent, thumbnails, window menu | Open, focus, minimise, restore, close from the dock | planned |
| (not in CoolDock) Replaces the taskbar | Hidden taskbar, app bar work area, restore on every exit | `tools/test-taskbar-restore.cmd`, plus D4 checks | planned |

## Live widgets (tiles with a popover)
| CoolDock widget | dotDock tile | Acceptance test | Status |
|---|---|---|---|
| Now playing | Now playing | Play, pause, skip in Spotify and a browser tab | planned |
| Calendar & meetings | Calendar, next event | Shows today and the next event from Windows calendar data, or a clear empty state | planned |
| Reminders & todos | To-do (shared with the home-screen widget) | Add, tick, persists | planned |
| Pomodoro | Focus timer | Start, pause, finish chime; survives restart | planned |
| Drink water | Hydration reminder | Interval fires a gentle notice; snooze | planned |
| Time widgets | Clock, world clocks | Correct across time zones | planned |
| Notes | Notes (shared with the home-screen widget) | Edit, persists | planned |
| System stats | CPU, RAM, disk, network, battery | Values match Task Manager within 5 % | planned |
| Quick toggles | Volume, mic mute, Wi-Fi, Bluetooth, brightness, night light, do-not-disturb | Each toggle changes the real setting and reflects outside changes | planned |
| Audio controls | Output device switch, per-app volume | Switch speakers to headphones | planned |
| Weather | Weather (Open-Meteo) | Shows the chosen place; offline state | planned |
| Clipboard | Clipboard history | Copy text and an image, paste from history; password-manager copies are never stored | planned |
| Screenshots | Screenshots (Windows.Graphics.Capture), recent list | Capture a region, open the last one | planned |
| File Shelf | File shelf | Drag files in, drag them out to another folder | planned |
| Files & downloads | Downloads | Newest downloads, open and show in folder | planned |
| Search (files) | App Library search: apps, files, calculator, units | Find an app, a file, `12*7`, `5 km in mi` | planned |
| App switcher | Running windows in the dock and the window menu | Switch between two windows of one app | planned |
| Voice memo | Voice memo | Record, play back, saved as a file | planned |
| Emoji | Emoji picker | Insert an emoji into Notepad | planned |
| Colour picker | Colour picker | Pick a pixel, copy hex | planned |
| Converter / calculator | In App Library search | as above | planned |
| Photos | Photo tile (shared with the home-screen photo widget) | Shows a chosen photo | planned |
| Progress | Day / week / year progress | Correct values | planned |
| Mail | Unread count only if Windows exposes it locally | needs an account otherwise | out of scope for now |
| Revenue, followers, analytics, Shopify, GitHub, Linear, Supabase, Dropbox | Not built | Need accounts and network access; conflicts with no-account, local-first | out of scope |

## How acceptance is run
- Each test is run by hand or script on this laptop; scripted ones live in `tools/dock-tests/`.
- A feature reaches the release only when **accepted** and scored 4.5 on the rubric.
- At release (D7) this table is summarised on the website and in the release notes.

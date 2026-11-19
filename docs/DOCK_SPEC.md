# DOCK_SPEC: the dock (v2)

Refines `MASTER_SPEC.md` section 11 at the P2 gate (section 15). Research: `docs/design/DOCK_RESEARCH.md`.
Every feature passes the double-check protocol and scores 4.5 or more before it is offered.

## 1. Goal
A dock that replaces the Windows taskbar and is the centre of the environment: apps filed into
category stacks automatically, a full-screen App Library with instant search, running windows with
live thumbnails, and a few excellent live tiles, all in the home screen's dot-matrix language.

## 2. Taskbar replacement strategy
- **Hide, never kill.** The native taskbar (`Shell_TrayWnd` and every `Shell_SecondaryTrayWnd`) is
  hidden with `ShowWindow(SW_HIDE)` and its auto-hide state is set through `SHAppBarMessage(ABM_SETSTATE)`.
  `explorer.exe` keeps running; the Start menu and Win key stay native in v2.
- **Snapshot first.** Before the first hide, the original auto-hide state (`StuckRects3` in
  `HKCU\...\Explorer`) is added to the Windows snapshot by `tools/snapshot-windows.ps1`.
- **Work area.** Setting: reserve space as a registered app bar (`ABM_NEW` / `ABM_SETPOS`) so
  maximised windows stop above the dock, or float over windows without reserving space (default: reserve).
- **Explorer restarts.** Listen for `TaskbarCreated`; re-hide the new taskbar and re-register the app bar.

## 3. Restore guarantees (all must be proven before the dock can hide anything)
| Exit path | How the taskbar comes back |
|---|---|
| Normal quit, "Use Windows desktop", uninstall | The core shows the taskbar and restores the auto-hide state. |
| Panic / crash | The panic hook restores, then the crash-loop guard (D-012) disables the dock after 3 unclean starts. |
| Hard kill (`taskkill /F`), power loss | A tiny watchdog process (`dotdock-sentinel`) waits on the core's process handle and restores when it ends. On next sign-in the core restores before doing anything else if the last run was unclean. |
| App will not start at all | `tools/restore-windows.ps1` shows the taskbar and restores the snapshot. |
| Shift held at launch | Safe mode: the dock does not hide the taskbar. |

## 4. Layout and surfaces
- **Dock bar**: a floating pill, bottom by default (top, left, right selectable), per monitor, auto-hide option.
- **Items, left to right**: pinned apps and category stacks, a divider, running apps that are not
  pinned, a divider, live tiles, the status pill (volume, network, battery, clock).
- **Category stack**: one tile showing up to four mini icons of its apps in a 2 x 2 grid. Click opens a
  stack popover: category name, a grid of its apps, tinted with the category colour. Arrow keys,
  type-to-filter, Esc closes.
- **App Library**: full-screen overlay (hotkey, or a dock button), search field on top, every category
  as a section with its apps; typing filters apps, then Start-menu files and calculator results.
- **Hover**: magnification with spring physics on the compositor (transform only); label tooltip.
- **Running indicators**: a dot under each running app; two dots for several windows; accent for the
  focused one. Badges where Windows exposes them.
- **Window menu**: hovering a running app shows live DWM thumbnails of its windows; click restores or
  minimises; right-click: new window, pin/unpin, move to stack, close all.

## 5. Automatic categories (the headline feature)
- **Sources**: Start menu shortcuts (`%ProgramData%` and `%APPDATA%\Microsoft\Windows\Start Menu`) and
  installed Store apps (`shell:AppsFolder`), enumerated through `IShellItem` / `SHGetKnownFolderItem`.
- **Classifier, in order**: (1) the user's own assignment; (2) a bundled, reviewed table of well-known
  apps by AppUserModelID or executable name; (3) Store category where available; (4) keyword rules on
  the name and publisher; (5) "Other". No network call, no AI service.
- **Default categories**: Productivity, Communication, Development, AI, Creative, Browsers, Media,
  Games, Utilities, System, Other. Rename, recolour, reorder, add and delete in Settings.
- **New installs** are filed automatically and announced once with a quiet badge on their stack.
- Drag an app between stacks to reassign; the assignment is stored in `%APPDATA%\<app>\dock.json`.

## 6. Live tiles (each a polished feature, offered only at 4.5+)
First wave: now playing, clock and calendar, focus timer (Pomodoro), system stats, weather, quick
toggles (volume through Core Audio, Wi-Fi and Bluetooth through the radio APIs, brightness).
Each tile opens a popover with its full controls. Second wave after the first is at 4.5: clipboard
history (respects "exclude from history"), file shelf, downloads, screenshots, notes, to-do.

## 7. Known hard areas (spike first)
- System tray icons: Windows 11 has no public API. v2 keeps a chevron that opens the native overflow.
- Notifications: need package identity; v2 shows a count only if obtainable, otherwise none.
- Live thumbnails: `DwmRegisterThumbnail` into a native child window layered with the WebView.
- Icon quality: `IShellItemImageFactory` at 256 px, cached as PNG in `%LOCALAPPDATA%`.

## 8. Milestones
| Milestone | Content | Gate |
|---|---|---|
| D0 | Snapshot/restore extended to the taskbar; sentinel; hard-kill test | Restore proven on every exit path in section 3 |
| D1 | Spikes: shell hook running-window list, icon extraction, DWM thumbnail, app-bar work area | Spike report in `docs/spikes/` |
| D2 | App catalogue and classifier with tests | Classifier accuracy on this machine's apps >= 90 % |
| D3 | Dock bar, pinned apps, stacks, stack popover, magnification | Rubric 4.5, perf gate |
| D4 | Running windows, thumbnails, window menu, taskbar hidden | Restore guarantees re-tested |
| D5 | App Library with search | Rubric 4.5 |
| D6 | Live tiles, first wave | Each 4.5 |
| D7 | Settings pages, website section, release | Owner review, then tag `v2.0.0` |

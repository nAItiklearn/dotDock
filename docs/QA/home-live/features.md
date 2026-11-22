# Home screen V1 live run (2026-11-21, home track)

Build: `target-rel/release/dotdock.exe` of 19:30 (commit c0aad66 frontend), real desktop, real cursor
(`tools/qa/home-live/features.mjs`, DevTools via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`). Raw results:
`v1/features.json`. Screenshots: `v1/*.jpg` (half size). The wallpaper was restored to the snapshot
(`original-wallpaper.jpeg`) after the run.

| Feature | Result | Evidence |
|---|---|---|
| Every widget renders real data | pass: clock, date, battery 2:15 left, RAM, disk C: 221.1 / 236.1 GB, music idle state | `v1/f01-widgets-render-real-data.jpg` |
| Enter edit mode from the widget menu | **not exercised**: the script right-clicked the bare clock between its digits, which is wallpaper (transparent pixels pass through), so Explorer's menu opened. Script fixed to use carded widgets; not re-run | `v1/f02-enter-edit-from-menu.jpg` |
| Toolbar inside the work area | not exercised (needs edit mode) | |
| Select A, then B | not exercised (needs edit mode) | |
| Deselect on a click on the empty desktop | pass (window under the click: Progman; no widget selected) | `v1/f05-deselect-on-empty-desktop.jpg` |
| Free move by drag | not exercised (needs edit mode); frame timing during the attempt: 728 frames, p95 16.8 ms, 0 dropped | `v1/f06-free-move-drag.jpg` |
| Resize, + Widgets, add, remove + undo toast, Done | not exercised (needs edit mode); covered by unit tests | |
| Wallpaper: Wind Meadow (dark) | pass: tokens and widget cards changed in one frame, 518 frames, max 21.5 ms, 0 dropped | `v1/f12-wallpaper-meadow-dots-dark.jpg` |
| Wallpaper: Paper Ring (light) | pass: 659 frames, max 20.1 ms, 0 dropped | `v1/f13-wallpaper-paper-ring-light.jpg` |
| Wallpaper: Soft Mono (dark) | pass: 543 frames, max 17.1 ms, 0 dropped | `v1/f14-wallpaper-soft-mono-dark.jpg` |
| Wallpaper: Liquid Gold (light) | pass: 656 frames, max 18.7 ms, 0 dropped | `v1/f15-wallpaper-liquid-gold-light.jpg` |
| Idle CPU, dotdock.exe, 10 s | pass: 0.052 % of the machine (WebView2 child processes not included) | |

Wallpaper rows: the theme each wallpaper gives is computed by `palettes.mjs` from the wallpaper's own
accent and mode through the app's `deriveColors`, and written to the theme tokens at the moment the
wallpaper changes. Re-deriving the palette by itself on a wallpaper change is the theme track's part
(B-home-1, reassigned to the theme track).

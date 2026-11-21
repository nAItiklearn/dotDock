# Dock contract and work split

Source of truth for types, commands and events: `apps/desktop/src/dock/protocol.ts`. Rust mirrors it
with serde `rename_all = "camelCase"` in crate `dotdock-dock`. Change both together.

## Layout (mirrors Agent Island)
| Part | Path | Owner |
|---|---|---|
| Restore watchdog | `apps/desktop/src-tauri/sentinel/` (bin crate `dotdock-sentinel`), `shell/src/taskbar.rs` | safety track |
| Dock backend (catalogue, classifier, icons, running windows, app bar, taskbar control) | `apps/desktop/src-tauri/dock/` (lib crate `dotdock-dock`) | backend track |
| Dock window host (Tauri window, commands, events, click-through) | `apps/desktop/src-tauri/src/dock_host.rs` | integration (after the tracks) |
| Dock UI | `apps/desktop/dock.html`, `apps/desktop/src/dock/` | UI track |

## Rules for every track
- Never leave the Windows taskbar hidden. Any test that hides it restores it in the same run, on success and failure.
- `replaceTaskbar` defaults to false. Nothing hides the taskbar for real use until D4 passes and the owner reviews it.
- No network calls, no telemetry. Originals only: no icons, art or code from CoolDock, LaunchMe or macOS.
- Each track commits in its own worktree branch; integration merges them.

## Changes
- 2026-11-20: added `dock://frozen` (`FrozenState { locked, displayOff, fullscreen }`), emitted by `DockService` (`dotdock-dock::frozen`). The UI freezes animation loops while any field is true.
- 2026-11-20 (host integration): the host serves four more things. `dock_set_focus({ active })` gives the window the keyboard while a text field, popover or edit mode needs it and hands it back. `dock_set_glass({ shapes, dark })` tells the core where to draw Windows' own acrylic (theme `glass`); the window is transparent, so the blur lives in a plate window just below it, cut to those rounded rectangles. `dock://library` (`"toggle"`) is emitted when Ctrl+Alt+Space is pressed. `dock://pointer` (`{ inside }`) is emitted when the cursor enters or leaves the `dock_set_regions` rectangles. `dock://frozen` carries `frozen` (any of the three) beside the three reasons.
- Icons reach the window as `http://dock-icon.localhost/<hash>.png` (WebView2 cannot load custom schemes); the backend still names them `dock-icon://<hash>.png`, and the host maps them in `dock_ready` and in the `dock://apps` and `dock://windows` events.
- The dock window is a transparent sheet over the primary monitor. The strip the dock reserves (app bar, `reserveSpace`) is only the bar plus its edge gaps: `iconSize * (1 + 2 * 0.17 + 2 * 0.2)` CSS px, mirroring `RATIO.pad` and `RATIO.edge` in `geometry.ts` (`dock/src/placement.rs`). Change both together.
- `dock_ready` is also the signal that the UI can draw: the window is shown, the strip reserved and the taskbar hidden only after the first call.
- 2026-11-21 (dock host): `dock_set_glass` is removed with the native glass plate (D-034); glass is the CSS plate only.

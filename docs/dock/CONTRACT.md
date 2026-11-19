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

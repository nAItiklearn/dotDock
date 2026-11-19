# Agent Island: what the Tauri core has to add

The island is finished as three self-contained pieces. The core only creates one window and forwards a few calls. Nothing here needs a change to the shell crate or to the overlay.

| Piece | Where | What it is |
| --- | --- | --- |
| `dotdock-island` | `apps/desktop/src-tauri/island/` | Library, no Tauri dependency. Reads hook state files, transcripts and Codex logs, merges them into snapshots, edits `settings.json` on Connect/Disconnect, finds the terminal window, tracks the cursor, plays chimes. |
| `dotdock-island-hook` | `apps/desktop/src-tauri/island-hook/` | The small executable Claude Code runs on each hook event. Records the event, exits 0. |
| Island window UI | `apps/desktop/island.html`, `apps/desktop/src/island/**` | The tiny pill and the island (optional subtitle, state row with a dot-matrix orb, and a strip where an original beetle walks a dotted landscape whose pose follows the state), plus `IslandSettingsPanel` for the Settings window. Contract: `src/island/protocol.ts`. |

Everything is local files only: no network, no AI calls, no tokens.

## 1. Cargo and build

`apps/desktop/src-tauri/Cargo.toml` already lists both crates as workspace members. In the main package add:

```toml
dotdock-island = { path = "island", features = ["watch"] }
```

`cargo build` (and `tauri build`) of the workspace produces `target/<profile>/dotdock-island-hook.exe` next to `dotdock.exe`. The app does not run that file in place. On Connect it copies it to `%LOCALAPPDATA%\dev.dotdock.desktop\island\dotdock-island-hook-<hash>.exe` and registers the copy, so the registered path survives updates, moves and portable runs, and an update never overwrites an executable Claude Code is running.

The app therefore needs to find the built hook at run time. Tell the service where (`ServiceConfig::hook_source`):

- Installed build: ship it as a resource so it lands next to the app. In `tauri.conf.json`: `"bundle": { "resources": { "target/release/dotdock-island-hook.exe": "dotdock-island-hook.exe" } }`, and in CI build it first: `cargo build -p dotdock-island-hook --release` before `pnpm tauri build`.
- Dev build: it sits next to `dotdock.exe` in `target/debug` after any workspace build.
- Portable single exe: the hook is not inside it. Either put the hook in the same folder or embed it with `include_bytes!` and write it out before calling `connect`. Until then Connect reports `hook-missing`, which the panel already explains.

Use `std::env::current_exe()?.parent()?.join("dotdock-island-hook.exe")` as `hook_source`.

CI needs no change: `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` and `cargo fmt --all --check` already cover both crates. Run the island tests with the watcher: `cargo test -p dotdock-island --features watch`.

## 2. The window

Create it next to the overlay in `setup`. It is a separate window with its own label; the overlay is untouched.

| Property | Value | Why |
| --- | --- | --- |
| label | `island` | capability and event targeting |
| url | `WebviewUrl::App("island.html".into())` | Vite entry added to `rollupOptions.input` |
| size | 520 x 240 logical px (`WINDOW_SIZE` in `protocol.ts`) | room for the island at scale 1.4, a 64 px top offset and its shadow |
| position | top-centre of the monitor: `x = monitor.x + (monitor.w - window_w_physical) / 2`, `y = monitor.y` | the island body offsets itself by the `topOffset` setting inside the window |
| flags | `transparent(true)`, `decorations(false)`, `shadow(false)`, `resizable(false)`, `skip_taskbar(true)`, `focused(false)`, `always_on_top(true)`, `visible(false)` | a floating, never-focused overlay |
| extended styles | `WS_EX_NOACTIVATE \| WS_EX_TOOLWINDOW` | clicking the island must not take focus from the terminal; reuse the helper in `desktop_host` but do not send it to the bottom |
| cursor events | `set_ignore_cursor_events(true)` at creation | click-through everywhere until the pointer poller says otherwise |

Show it when the UI calls `island_ready` (same pattern as `overlay_ready`, with the same 3 s fallback). Capability `capabilities/island.json`: windows `["island"]`, permissions `core:event:allow-listen`, `core:event:allow-unlisten` (copy `overlay.json`).

The window is always shown, transparent and click-through while idle. "Hidden when idle" is drawn by the UI (it renders nothing), so there is no show/hide logic and no first-paint delay when a session starts.

## 3. Starting the service

```rust
use dotdock_island::{paths::ClaudeDirs, service::{Host, IslandService, NotificationCopy, ServiceConfig}};
use dotdock_island::{engine::{Alert, Snapshot}, settings::IslandSettings};

struct TauriHost(AppHandle);

impl Host for TauriHost {
    fn snapshot(&self, snapshot: Snapshot) { let _ = self.0.emit_to("island", "island://snapshot", snapshot); }
    fn settings(&self, settings: IslandSettings) { let _ = self.0.emit_to("island", "island://settings", settings); }
    fn notify(&self, copy: NotificationCopy, _alert: Alert) {
        // tauri-plugin-notification: self.0.notification().builder().title(copy.title).body(copy.body).show()
    }
}

// in setup, after the window exists:
if let Some(dirs) = ClaudeDirs::from_env() {
    let service = IslandService::start(
        ServiceConfig {
            dirs,
            data_dir: dotdock_shell::app_data_dir().ok_or("no app data dir")?,
            hook_source: std::env::current_exe()?.with_file_name("dotdock-island-hook.exe"),
        },
        TauriHost(handle.clone()),
    )?;
    app.manage(Arc::new(service));
}
```

`IslandService::start` loads `island-settings.json` from the data dir, starts the watcher thread, and, only for users who already connected, repoints the hook entries if the app moved or updated (silent, backed up, our entries only). A user who disconnected stays disconnected.

### Commands the window calls

All return plain serialisable values; errors are `Result<_, String>` (use `err.to_string()`). The JavaScript argument keys are the Rust parameter names, so they must be exactly `id`, `regions` and `settings` as in the table. `island_connection` is available for a Settings window that opens before the island does; the island window itself gets the status from `island_state` and from the results of connect and disconnect.

| Command | Arguments | Returns | Implementation |
| --- | --- | --- | --- |
| `island_ready` | none | nothing | show the window |
| `island_state` | none | `InitialState` | `service.initial_state()` |
| `island_set_regions` | `regions: Regions` | nothing | store in a `Mutex<Regions>` read by the pointer poller (section 4) |
| `island_focus` | `id: String` | `"focused" \| "window-not-found" \| "session-ended"` | `service.focus(&id)` |
| `island_dismiss` | `id: String` | nothing | `service.dismiss(&id)` |
| `island_connect` / `island_disconnect` | none | `ConnectionStatus` | `service.connect()` / `service.disconnect()` |
| `island_connection` | none | `ConnectionStatus` | `service.connection()` |
| `island_set_settings` | `settings: IslandSettings` | `IslandSettings` | `service.set_settings(s)`; fires `island://settings` |

### Events the window listens to

| Event | Payload | When |
| --- | --- | --- |
| `island://snapshot` | `Snapshot` | whenever something visible changes (seq increases); never on a timer |
| `island://settings` | `IslandSettings` | after `set_settings` |
| `island://pointer` | `{ inside: boolean }` | cursor enters or leaves the island footprint |

Types are in `src/island/protocol.ts`; the Rust side serialises with camelCase (`engine::Snapshot`, `settings::IslandSettings`, `service::{InitialState, ConnectionStatus}`).

## 4. Click-through, move-aside and monitor following

A click-through window receives no mouse events, so the cursor is polled the way D-006 already does for the overlay (one `GetCursorPos` per tick; 16 ms near the island, 80 ms elsewhere). `dotdock_island::pointer` holds the logic and the thread; the core supplies the window geometry and applies the results:

```rust
use dotdock_island::pointer::{self, PointerEvent, Regions, Target};

// state: Arc<Mutex<Regions>> set by island_set_regions;
//        Arc<Mutex<(i32, i32, f64)>> = window x, y (physical) and scale factor, kept current from
//        WindowEvent::Moved / ScaleFactorChanged and after every programmatic set_position.
let poller = pointer::spawn_poller(
    move || {
        let (x, y, scale) = *lock(&geometry);
        let screen = lock(&regions).to_screen((x, y), scale);
        let follow = lock(&settings).follow_cursor.then(|| pointer::monitor_at((x + 1, y + 1))).flatten();
        Some(Target { regions: screen, island_monitor: follow })
    },
    move |event| match event {
        PointerEvent::Interactive(on) => { let _ = window.set_ignore_cursor_events(!on); }
        PointerEvent::Hover(inside) => { let _ = app.emit_to("island", "island://pointer", json!({ "inside": inside })); }
        PointerEvent::TopEdge(monitor) => { /* set_position(top-centre of `monitor`), update `geometry` */ }
    },
)?;
// keep `poller` alive in managed state; dropping it stops the thread
```

The UI reports two things through `island_set_regions`: `interactive` (where it accepts clicks) and `hover` (the footprint whose enter/leave drives "moves aside"). While the island is aside, `interactive` is empty (clicks pass through to the app underneath) but `hover` stays the resting footprint, which is how it knows when to come back without flicker.

## 5. Tray and Settings

- Tray: one check item "Agent Island" that flips `settings.enabled` through `service.set_settings`. When `enabled` is false the service stays quiet (no chime, no toast) and the UI draws nothing.
- Settings window: embed `IslandSettingsPanel` from `src/island/settings/IslandSettingsPanel.tsx` (it imports its own CSS and connects on mount; the host window must import `design-system/tokens.css` and call `applyTheme`). It talks to the same commands, so every control is real: idle mode, size, offset, icon style, what to show (file or command, tokens, elapsed time, project, the creature and landscape strip), move-aside, follow cursor, Codex on/off, notification and sound with volume, how long a finished task stays. It also holds Connect / Disconnect with the status text and the path of the file it edits.
- Settings persist in `%LOCALAPPDATA%\dev.dotdock.desktop\island-settings.json` (schema 1, values clamped on load, a corrupt file is kept as `.bak` and defaults are used).

## 6. Where things run

| What | Where | Cost |
| --- | --- | --- |
| File watching | one `island-monitor` thread, `notify` (ReadDirectoryChangesW) on the sessions folder, the transcript folders of active sessions, and `~\.codex\sessions` (recursive) | blocks until Windows reports a change or the next deadline (a terminal state collapsing) |
| Safety tick | the same thread, every 4 s, only while a session is active | one `stat` per active transcript and one `OpenProcess` per active session; catches change notifications Windows delays for files held open for appending, and detects a closed terminal |
| Pointer poll | `island-pointer` thread | one syscall per tick |
| Hook | separate short process per Claude Code event | see section 8 |

There is no fixed-interval polling of the state files.

## 7. Notifications and returning to the right terminal

The service plays a chime (synthesised, no audio files) and calls `Host::notify` for these moments, each once and never replayed after a restart: a task finished, the agent is waiting for you (permission or a question), a usage limit, a login or connection error. Both can be switched off in settings. Copy comes from `service::notification_copy`.

Returning to the terminal, in order of strength:

1. Clicking the island calls `island_focus`. `focus::focus_session` walks up from Claude Code's process to the first ancestor that owns a visible window (Windows Terminal, VS Code, Cursor, WezTerm, ...), prefers a window whose title mentions the project (VS Code titles do), restores it if minimised and raises it. If Windows refuses the foreground change it presses a synthetic Alt and retries, and as a last resort flashes the taskbar button. This always works from the island because the click is the last input event.
2. If the process is gone it returns `session-ended`; if no window can be found, `window-not-found` and the UI says so for a moment.
3. Windows Terminal and VS Code host many sessions in one process, so the exact tab cannot be selected from outside; the right window is. Selecting the tab would need UI Automation and is not attempted.
4. A system toast cannot return you to the terminal by itself: `tauri-plugin-notification` has no click callback on desktop Windows. The island stays up and clickable for the "finished" linger time (6 s by default, up to 30 s in settings) as the primary path. Upgrade path if wanted: raw toast XML with `activationType="protocol"` and a `dotdock://island/focus?session=<id>` launch URI, a protocol handler registered under `HKCU\Software\Classes\dotdock` (an HKCU key of the app's own, to be recorded in `docs/DECISIONS.md` before use) and the single-instance callback calling `service.focus(id)`.

## 8. Connect, Disconnect and the hook

`service.connect()` installs the hook copy, then edits only the user-level `%USERPROFILE%\.claude\settings.json` (or `CLAUDE_CONFIG_DIR`):

- It refuses to write if the file is not valid JSON or has an unexpected shape.
- It writes a timestamped backup next to the file first (`settings.json.dotdock-island-backup-<ms>`, newest five kept) and writes atomically, re-checking that Claude Code did not change the file in between.
- It adds exactly one entry per event for `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `StopFailure`, `SessionEnd` and `Notification` (matcher `idle_prompt|permission_prompt|agent_needs_input`), in exec form so no shell starts: `{ "type": "command", "command": "<path>", "args": [], "async": true }`. Entries are recognised by the executable name starting with `dotdock-island-hook`.
- Connecting twice changes nothing; Disconnect removes only those entries (and the `hooks` object if it became empty), so a connect followed by a disconnect restores the original document.
- Other hooks, permissions and every other key keep their values and order. Project settings files are never touched.

Restart Claude Code sessions that were already open: hooks are read at session start.

The hook reads the event from stdin, writes `<sessions>\<session id>.json` atomically under a short lock, and always exits 0 (a panic handler exits before the release profile's abort). It never stores prompt text or tool output; commands are shown by their description when Claude wrote one, otherwise with obvious secrets masked.

Measured on this laptop (Windows 11, Defender on, many autostart apps, release GNU build, 438 KB, 40 runs each, kernel process lifetime from start to exit): a full event takes a median of 77 ms (min 59 ms, p90 172 ms); a run with empty input, which only starts and exits, takes 74 ms. So the hook's own work adds about 3 ms to what Windows spends creating any process here; a first, busier measurement had medians of 375 ms for the hook against 780 ms for `cmd /c exit`. Profiled inside one cold process the work is about 6 ms (stdin parse 0.2, parent lookup 0.4, lock 0.7, read 0.5, write plus rename 3.4), before the later removal of two directory-exists calls. The "under 20 ms" goal is therefore met for the hook's work but not for wall time on a machine where an empty process already takes 74 ms. Hooks are registered `async`, so Claude Code never waits for them.

## 9. Sources and formats

| Source | Path | Notes |
| --- | --- | --- |
| Hook state | `<config>\tools\island\sessions\<session>.json` | schema 1, written by the hook |
| Claude transcript | path from the hook payload (`~\.claude\projects\<project>\<session>.jsonl`) | tail and incremental reads only; interruption marker `[Request interrupted by user]`, API errors via `isApiErrorMessage` + `error`, tokens from `message.usage.output_tokens` de-duplicated per message id, titles from `ai-title` / `custom-title` records |
| Codex | `~\.codex\sessions\YYYY\MM\DD\rollout-*.jsonl` | `task_started`, `token_count`, `task_complete`, `turn_aborted`, tool calls; formats are not a public contract and unknown lines are skipped |

Claude Code writes the transcript asynchronously, so `Stop` carries `last_assistant_message` and the island uses that for the summary.

## 10. Decisions taken (to copy into `docs/DECISIONS.md` with the next free numbers)

- **Hook registration uses exec form and `async`.** No Git Bash or PowerShell starts per event, and Claude Code never waits for the hook. Alternative: a shell-form command, which depends on which shell Claude Code finds and on quoting. Reverse: write a shell-form entry in `connect.rs::desired_entry`.
- **The hook is copied to the app data folder under a content hash.** Registered paths survive updates, moves and portable runs, and the copy in use is never overwritten. Alternative: register the install path directly.
- **No idle-pause guessing.** The reference marks a turn "paused" when nothing is written for a few seconds. That shows a wrong state during long thinking, so the island relies on explicit signals instead: the interruption marker in the transcript, `PostToolUseFailure` with `is_interrupt`, the `idle_prompt` notification, and process liveness. A silent cancel therefore shows "thinking" until Claude Code's own idle notification, about a minute later.
- **Token counts are only ever real.** No estimate fills the gap between transcript writes; the UI tweens between real values.
- **A `waiting` state exists** (permission prompt, question, plan approval) with its own icon and chime. The reference has none; it is the moment people most often miss.
- **Chimes are synthesised**, not shipped, so there is no audio licence to track.
- **Session ownership by process id plus creation time**, so a reused id is never mistaken for a live session, and a protected (elevated) process that cannot be opened counts as alive.

## 11. Verification status

- `cargo test -p dotdock-island --features watch`: unit and integration tests with synthetic fixtures (no real transcripts are committed). Connect/Disconnect run only against temp folders.
- Frontend: `pnpm typecheck`, `pnpm test` (175 tests: icon frames, creature poses and landscape, walk motion, labels, selection and pinning, formatting, geometry, regions, store) and `pnpm build` pass. Every state, the tiny and hidden idle modes, the multi-session pager, the three themes, the three icon styles, scale 0.8 to 1.4, long strings, move-aside and reduced motion were checked in a plain browser through the dev-only fixture panel, which is absent from the production bundle (searched `dist` for its strings: none).
- The transcript readers were run over a real 17 MB transcript (read only): token total and context size match an independent computation exactly, and a 300 KB incremental read takes about 4 ms.
- The hook was run by the real Claude Code 2.1.316 against a temp config dir (`CLAUDE_CONFIG_DIR`): a blocked `UserPromptSubmit` (no model request) fired the exec-form entry, with and without `async`, and wrote a correct state file.
- **Live end-to-end, 2026-11-20:** the release build ran on this laptop with the hook registered in a throwaway project's own `.claude/settings.json` (the user's `~/.claude/settings.json` was not touched), and real headless Claude Code 2.1.316 sessions drove it. Screen recordings (`.cache/island-e2e/`, not committed) show the island following each session live: Thinking, Running "List files and show notes.md and math.py", Reading `math.py`, Editing `math.py`, Running "Print math.py contents", then Done with the tick, with the output-token count rising (123, 312, 458, 593) and the beetle animating; it then collapses to the idle pill. A killed session also returns the island to idle. Fixed during the run: the plate was translucent, so text behind it showed through; it is now opaque in every theme.
- Seen during the run, not an island issue: headless `claude -p` sessions on this machine finish their work but the process does not exit (the island correctly shows Done); the owner's global hooks are the likely cause.
- Not verified here: the toast path, Windows Terminal tab selection, Codex phases that this laptop's logs do not contain (`turn_aborted`, approval requests and `error` are implemented from the Codex protocol and covered by synthetic tests only).

## 12. Open risks

- `args` exec form needs a Claude Code new enough to support it (2.1.316 does). On an older one the entry would be run as a shell command and fail quietly.
- `StopFailure`, `PostToolUseFailure` and the `agent_needs_input` Notification matcher are in the current hooks documentation; a much older Claude Code might reject unknown events in `settings.json`.
- The `~/.claude/sessions/<pid>.json` registry that Claude Code keeps (pid, process start time, session name, busy/idle) is undocumented and deliberately not used.
- Windows can delay file-change notifications for a transcript that Claude Code holds open; the 4 s safety tick bounds the delay.
- Portable single-exe builds do not carry the hook (section 1).

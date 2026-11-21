# Progress

**Version:** v1 (home screen, Agent Island, Settings, website). Tagged `v1.0.0` locally, not released.
**Next:** v2, the dock and launcher. The owner's rule: no public release until the dock ships.

## v1: what is done
### Core (Rust, Tauri 2)
- Desktop overlay at desktop level: hidden until the UI is ready, cursor-driven click-through, one guard thread owns its Win32 styles (D-010), re-fits on display and DPI changes.
- Providers pushed to the UI: RAM, CPU, disk, battery (1 Hz), system media session with transport controls, weather from Open-Meteo.
- Reversible launch at sign-in (logon task, Run-key fallback, D-011), crash-loop guard and Shift safe mode (D-012), panic log, boot stage timing in `boot.log`.
- Tray menu, on-demand Settings window, second launch opens Settings.
- Measured cold start (local release build, 3 runs): window shown 1003 / 856 / 721 ms after process start.

### Safety
- `tools/snapshot-windows.ps1` and `tools/restore-windows.ps1`, tested on this machine; the original state is snapshotted.

### Home screen
- Design system: tokens, three themes (Obsidian, Paper, Aurum), dot-matrix glyphs and pictograms, line icons.
- Widgets offered (all scored 4.5 or more): clock, date, battery, system, music, fun fact, timer, world clocks, **photo** (D-015). The photo widget has eight sizes and borders (keyline, mat, polaroid with caption, dot matrix) with rounded, squircle and circle-or-pill masks (D-025), colour, width, radius and shadow in its settings panel. Visual QA over seven wallpapers, 0 dropped frames resizing, reviewer B fixes: 4.83 on the rubric, lowest 4.8 (`docs/QA/photo-widget.md`).
- Held below the 4.5 bar, code present but not offered: weather 4.0, quote 4.2 (D-016), calendar 4.4, notes, to-do.
- Edit mode: transform-only drag, snapping, guides, undo and redo, widget drawer, per-widget settings, profiles.
- 24 original procedural wallpapers (12 styles, dark and light) with thumbnails; desktop versions of the owner's phone mood images are in progress (see below).

### Agent Island
- Session engine, Claude Code hook and Codex log watcher, reversible Connect (D-014).
- Island window: notch with the 7 x 7 state icon, detail line, token count, the original beetle and landscape strip.

### Settings app
- Instant-apply pages, search, theme editor, native-backed pages (startup, wallpaper, restore, performance, shortcuts).

### Website (`website/`, Astro, static)
- Home, download, FAQ, licence and privacy pages; live widgets; the island notch plays a scripted session with the app's own scene code.

### Brand (`brand/`, `tools/brand-gen`)
- New logo: a dot docked in a pill, reading as a `d` (D-019). One master drawing generates the Tauri icons (multi-size `.ico` with hand-redrawn 16 to 32 px), favicon, apple-touch icon, the website nav mark, SVG logos, a Doto wordmark and the 1280 x 640 social preview. The tray now loads the small-icon size. Usage guide in `brand/README.md`; QA in `docs/QA/brand-logo.md` (4.62 on the rubric).

### Time tracking
- Hackatime hook fixed on 2026-11-19 after heartbeats were being killed; see `docs/HACKATIME_STATUS.md`. Nothing was back-filled.

### Verification at v1
- Desktop: `pnpm typecheck` clean, `pnpm test` 658 passed.
- Rust: `cargo check` clean (local GNU toolchain); MSVC build and installer in CI.
- Website: `pnpm build` (sync notices, contrast check, `astro check`, build) clean.

## In progress
- Desktop wallpapers from the owner's mood images (louvre and soft-mono reworked, four new styles). Generated from code only.
- **Dock backend (milestones D1 and D2), branch `worktree-agent-a175321c268719d26`:** crate `dotdock-dock` with the app catalogue (214 apps on this machine), classifier (98.1 % on the first judged run, `docs/spikes/DOCK_CLASSIFIER.md`), 256 px icon cache, push-driven window list, launch, DWM thumbnails, the app-bar spike and the `DockService` facade. Idle CPU 0.08 to 0.13 %, warm start 140 to 240 ms with nothing scanned or extracted (`docs/spikes/DOCK_D1.md`, D-019). Not wired into the app yet; the host (`dock_host.rs`) and UI are the other tracks.

## v2: the dock (in progress)
**Release rule (owner, 2026-11-20):** release the app and the website once everything averages 4.8 on the rubric and every phase of `docs/QA/V2_TEST_PLAN.md` has passed.
- Spec `docs/DOCK_SPEC.md`, research `docs/design/DOCK_RESEARCH.md`, benchmark vs the macOS Dock and CoolDock `docs/design/DOCK_BENCHMARK.md`, contract `docs/dock/CONTRACT.md` + `apps/desktop/src/dock/protocol.ts`.
- D0 safety: done so far: both restore paths show the taskbar and restore auto-hide (tested live). Running: sentinel watchdog and hard-kill test (safety track).
- D1 + D2 running (backend track): app catalogue, automatic category classifier, icons, running windows, launch, thumbnail and app-bar spikes.
- D3 running (UI track): dock bar, magnification, category stacks, App Library, edit mode, three themes.
- D6 running (tiles track): native providers in `apps/desktop/src-tauri/tiles/` (crate `dotdock-tiles`, no UI framework). `DockTiles` serves the UI's seven first-wave feeds and six commands in the shapes of the UI's `ui-types.ts` (audio, microphone and its level, calendar as next meeting and agenda, contacts, plus a core-owned stopwatch and water log); `TileHub` serves the second wave (clipboard, screenshots, downloads, shelf, toggles, system history, voice memo, colour picker). Providers run only while a tile that needs them is on the dock. `cargo test -p dotdock-tiles`: 166 passed, 2 audible tests run on request (`-- --ignored`); clippy `-D warnings` clean. What each tile reads and what was measured: `docs/dock/TILES.md`. Decisions: D-024. Host wiring (Tauri commands and events) is the integration step.
- Rule: the Windows taskbar is never hidden for real use until D4 passes and the owner reviews it (`replaceTaskbar` defaults to off).

Merged on main:
- D0 safety: taskbar marker, sentinel watchdog, recovery at start; 120/120 real restore tests; sentinel bundled in the MSVC installer.
- D1/D2 backend `dotdock-dock`: 214 apps, classifier 98 %, 256 px icons, running windows, launch, DWM thumbnails, app-bar spike; idle 0.08 to 0.13 % CPU.
- Logo and icon set; six desktop wallpapers at 4.5+; island verified live with real Claude Code sessions (plate made opaque).
- Specs: DOCK_SPEC, DOCK_BENCHMARK (incl. stack input-to-visible under 50 ms), DOCK_MARKET, FEATURE_PARITY, WEBSITE_SYSTEM, LAUNCH_VIDEO, V2_TEST_PLAN.

Running (worktree tracks): dock UI (latency fix, every feature testable, CoolDock tiles, themes incl. glass), native tiles (real data), dock host integration (window, glass backdrop, app bar, taskbar replacement), notch for any AI agent (Copilot CLI, OpenCode, generic protocol), the environment as one unit with two Settings switches and a theme from the user's own wallpaper (branch worktree-agent-aa4d6d019cc73921a, D-021 and D-022), website redesign (Inter Display, art-led hero, Features page, showcase strip).

## Machine notes that affect boot time
- 22 apps autostart from `HKCU\Run` and compete at sign-in.
- Wallpaper Engine autostarts and paints over the Windows wallpaper; the overlay must coexist.
- Display 1920 x 1080 at 125 % scaling.

## Known issues
- B-001 closed by D-005: MSVC builds run in CI; local builds use the GNU toolchain.
- A removed photo widget's file stays in IndexedDB (D-015).

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
- Widgets offered (all scored 4.5 or more): clock, date, battery, system, music, fun fact, timer, world clocks, **photo** (D-015).
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

### Time tracking
- Hackatime hook fixed on 2026-11-19 after heartbeats were being killed; see `docs/HACKATIME_STATUS.md`. Nothing was back-filled.

### Verification at v1
- Desktop: `pnpm typecheck` clean, `pnpm test` 658 passed.
- Rust: `cargo check` clean (local GNU toolchain); MSVC build and installer in CI.
- Website: `pnpm build` (sync notices, contrast check, `astro check`, build) clean.

## In progress
- Desktop wallpapers from the owner's mood images (louvre and soft-mono reworked, four new styles). Generated from code only.
- **Dock backend (milestones D1 and D2), branch `worktree-agent-a175321c268719d26`:** crate `dotdock-dock` with the app catalogue (214 apps on this machine), classifier (98.1 % on the first judged run, `docs/spikes/DOCK_CLASSIFIER.md`), 256 px icon cache, push-driven window list, launch, DWM thumbnails, the app-bar spike and the `DockService` facade. Idle CPU 0.08 to 0.13 %, warm start 140 to 240 ms with nothing scanned or extracted (`docs/spikes/DOCK_D1.md`, D-019). Not wired into the app yet; the host (`dock_host.rs`) and UI are the other tracks.

## v2 plan (next)
- Dock and launcher replacing the taskbar, with an App Library that groups apps by category (productivity, social, coding, AI, and more). Study the owner's dock videos and images, launchmeapp.com and cooldock.app first; build originals only.

## Machine notes that affect boot time
- 22 apps autostart from `HKCU\Run` and compete at sign-in.
- Wallpaper Engine autostarts and paints over the Windows wallpaper; the overlay must coexist.
- Display 1920 x 1080 at 125 % scaling.

## Known issues
- B-001 closed by D-005: MSVC builds run in CI; local builds use the GNU toolchain.
- A removed photo widget's file stays in IndexedDB (D-015).

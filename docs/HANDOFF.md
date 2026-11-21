> **Superseded (2026-11-21 22:40):** read `docs/NEXT_SESSION.md` first; this file is the older 2026-11-20 handoff.

# Session handoff (2026-11-20, 22:30)

Read this first in the next session, then `PROGRESS.md` and `CLAUDE.md`. Every background agent from this
session stops when the session ends. Their work lives in git worktrees under `.claude/worktrees/` and is
committed on their branches. Nothing below is merged into `main` yet.

## Rules learned this session (also in memory)
- **Start every subagent with `model: "opus"`.** The environment sets `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-5-5`,
  so agents started without it run on Sonnet. All tracks below except the four marked Opus ran on Sonnet.
- **Be strict:** check commits per worktree every 30 min. An agent with no commit in 60 min gets pushed. After two
  pushes, save its work as a WIP commit and restart it on Opus from that commit.
- **Live, visible testing:** run the dock, the notch, the theme and the website on the owner's screen at a human
  pace, save screenshots under `docs/QA/*-live/`, and tell the owner when each is ready to watch.
- **Never gradients**, including test harnesses and captures. Default backdrop for tests, demos and videos, and the
  first-run default wallpaper for new installs: the **green windswept-grass** wallpaper (from the website's
  Aurum preview).
- **Whole environment, no per-part toggles.** Only two low-key switches, at the very end of Settings:
  "dotDock theme on/off" and "Use the Windows taskbar" (D-021).
- **Keep build output on D:**, never C:.
- Hackatime: `heartbeats_last_sent_at` in `~/.wakatime/wakatime-internal.cfg` stayed current all session (hook
  `tools/hackatime/heartbeat.mjs`). Never fabricate heartbeats.

## Tracks: branch, state, next step
Every branch is `worktree-agent-<id>`, in `.claude/worktrees/agent-<id>`.

| Track | Worktree id | State at handoff | Next |
|---|---|---|---|
| Dock UI | `adc1436635b68486c` | 10 commits: stacks, App Library, context menu, previews, edit mode, effects, live tiles + popovers, themes incl. glass, in-dock widget gallery, customise on the dock (right-click menu, edit mode, settings popover), harness on real wallpapers, test proving the DEV fixture panel never ships | Make every row of `docs/dock/FEATURE_PARITY.md` pass with evidence; add the CoolDock-gap tiles (network graph, sun arc, wind, flip/analog clock, currency/unit converter, web search, history, waveform memo, audio devices, emoji, Pomodoro sessions, hydration wave, dot-grid month); 60 fps trace; grass wallpaper as the harness default |
| Native tiles (**finished**) | `a86661ab15f35ff36` | Done; ready to merge after review. 167 tests, fmt and clippy clean. Expect a D-019 text conflict in DECISIONS.md at merge. Untracked leftovers to delete: root `package.json` and `pnpm-lock.yaml`, `apps/desktop/src/dock/tiles/models/`. The screenshot and voice-memo tiles save to the user's Pictures/Documents only when the user presses the button (product behaviour, fine). Mute was toggled once and restored. HEAD 57fc92c, 167 tests. `DockTiles` speaks the UI's `ui-types.ts`; 7 feeds with real data on this machine (agenda and meeting need a calendar account). See `docs/dock/TILES.md` | Diff against the UI branch's latest tiles; the host wiring is done in the dock host track |
| Dock host (Opus) | `ad872134ea0e058d4` | WIP commit of the stopped first attempt (134 files, incl. copied UI files to clean up). The Opus agent was merging the UI and tiles branches when the session ended | Merge `adc14…` and `a86661…`, drop the copies, revert stray widget edits; run the real dock on the desktop over the grass wallpaper with real apps and DockTiles; glass; app bar; taskbar replacement through the D0 safety path (restore it, auto-hide back ON); 60 fps; live QA in `docs/QA/dock-live/` |
| Notch | `a169e2607b1c66971` | 4 commits: generic agent feed protocol (`docs/ISLAND_PROTOCOL.md`), Copilot CLI and OpenCode adapters, Connect/Disconnect, feed in the monitor | **Live visible test is still missing:** island on the desktop driven by a real Claude Code session, plus replayed Codex, Copilot, OpenCode and generic sessions; `docs/QA/notch-live/` |
| Theme + two switches | `aa4d6d019cc73921a` | Module lifecycle manager, AA palette from the wallpaper, theme from your wallpaper (preview, apply, undo), the two low-key switches, D-021/D-022 | Grass wallpaper as the first-run default (port it into the app set if it only exists on the website branch); live theme run in `docs/QA/theme-live/`; confirm its old cargo target on C: under `%LOCALAPPDATA%\dockDock` is deleted |
| Settings IA + restyle (Opus) | `a140991fdc0a4c940` | `docs/design/SETTINGS_IA.md`; six sections with tabbed pages; 5 real bugs fixed | macOS System Settings + website look (grouped inset lists, Inter Display, calm sidebar, no noisy dot-font titles); every row backed by a real setting with a test, or removed; Wallpapers page shows real thumbnails (no gradients) and really applies; real theme miniatures; controls audit with a "real effect" column; live run in `docs/QA/settings-live/` |
| Photo widget (Opus fix-up) | `a2995d281cddb8f8d` | 8 sizes, 5 borders, 3 shapes, live settings panel; then caption AA, edge hairline, eased geometry, off-thread decode cache; 752 tests | Visual QA over wallpapers, perf trace, rescore (was 4.79; must be ≥ 4.8), fresh reviewer B |
| GitHub/dev tiles (Opus) | `a60a1abdd36a54bde` | Crate `integrations` builds, 79 tests, clippy clean (ee66edc); PAT in Credential Manager | Streak and polish, Linear, Vercel, "AI tokens" from island session data, TS tiles + gallery entry + Settings token fields |
| Website | `a81d99eac949307ec` | Pixel-flower hero, nav with Features and GitHub mark, Features page, scaled theme previews, real dock captures started, photo frames, anonymous Vercel visit counter (Upstash, 503 and hidden when unset), new motifs (dragonfly, lilies, concentric peonies, butterflies, birds, fish), art moved out from behind text | Add the **octopus and horse** (the owner asked for them); write and run the automated text-over-art check at 1440/1024/768/390 on every page; real dock captures in every home-screen preview (no fake taskbar); grass wallpaper default; Lighthouse; then serve the build with `pnpm preview` (tools/preview.mjs, `.vercel/output/static`) on http://127.0.0.1:4330 and show the owner |

## Owner feedback at the very end of the session (not yet passed to any agent)
- The dock preview the owner saw still used the right-hand DEV fixture panel to show the features. That panel is
  dev-only by design, but the owner judges the dock by what they see. In the harness, make the customisation
  through the dock itself (right-click menu, edit mode, settings popover, committed as "customise on the dock
  itself") the visible way to try features. Hide the DEV panel by default behind a key, and keep the
  "fixture panel never ships" test. Re-run the live demo so the owner sees the new on-dock flow.
- **Dock section in Settings:** add a full Dock section with its own pages (Items, Tiles, Appearance with
  **dock themes**: glass, glass-lite, Obsidian, Paper, Aurum, minimal, each with a live preview over the grass
  wallpaper; Behaviour: size, magnification, position, auto-hide; Taskbar). Every part of the app gets its own
  clear section, in the macOS + website look.

## Major finding: why the app "feels fake" (Settings track, 22:55)
The TypeScript native API calls about 20 core commands that do not exist in `src-tauri/src/lib.rs`: startup_get/set,
displays_list, wallpapers_assignments/assign/import/remove, performance_*, shortcuts_register, settings_open,
app_info, app_open_data_folder and updater_*. Only wallpapers_list, wallpaper_apply, restore_windows and
autostart_set are registered. So in the real app most native Settings pages fail, global hotkeys never register,
and "Open Settings" in the edit toolbar fails silently. The Settings track (`a140991…`) is wiring the real
commands (startup, displays, wallpapers including importing your own picture, app info and open data folder,
settings_open, global hotkeys) and removing rows with no backing (pause rules, refresh rate, updates) until the
core implements them. **Before release, add a test that fails if any `invoke("…")` name in the TS has no
registered Tauri command.**

## Owner's website checklist (all mandatory)
1. Art-led hero with the pixel flowers. Clean: short title, one subline, one CTA, no licence/open-source/telemetry chips.
2. Small red flowers crafted; no grey stones.
3. GitHub mark in the nav; Features in the nav and a full Features page with the **dock first**, as detailed blocks with bullets and real clips or screenshots, then the notch, widgets and themes.
4. Real dock everywhere, never the fake taskbar; showcases show the full theme (widgets + dock + notch) in Obsidian, Paper and Aurum, with no overlap or clipping.
5. Photo widget on the showcase: **borderless** (no dotted ring), and **no cake photo**. The owner wants the
   Drake (`b016523e…jpg`, halftone) or Travis Scott (`dc5808b0…jpg`) photo. These show public figures and are
   probably not the owner's own photos: do not publish them until the owner confirms they have the rights.
   Until then use no photo, or an original image from the art engine.
6a. **Scale:** the site looks best at 90% browser zoom, so make 100% feel like 90% by scaling the type, spacing,
   widths and component tokens down about 10% (never CSS zoom). Fully responsive at 390, 414, 768, 1024, 1280 and 1440,
   with no overlap anywhere.
6. Background art in the page background every few sections, varied subjects, never under text, calm white space; references are the inspiration images in the repo root (study them, never copy).
7. Visit counter, video slots (main ~60 s, dock ~30 s, notch ~30 s, hidden until real files exist), tasteful sample marks, proofread text, footer kept, Inter Display, fast.
8. No "switch parts off" messaging.

## After everything is built (owner's release order)
1. Merge each track to main after the double-check protocol (build, self-verify, reviewer A, visual QA + perf, fresh reviewer B).
2. Record the videos (main, dock, notch) from the real app over the grass wallpaper, then take screenshots.
3. Put them on the website, polish until it averages ≥ 4.8, and pass every phase of `docs/QA/V2_TEST_PLAN.md`.
4. Release the website (Vercel) and the app installer (CI MSVC build). The owner authorised this at 4.8.
5. Then clean up finished worktrees and build output with the owner's go-ahead (dotDock uses more than 30 GB).

## Housekeeping done this session
- `ffdbc63` on main: `target-gnu/` untracked and ignored (483 build files were committed by mistake).
- Build output of three merged worktrees deleted to free space on D:.
- Stale servers: :4321 is an old `astro preview` of main (shows the OLD site, so don't send the owner there), and
  :4330 is an `astro dev` of the website worktree started from this session.

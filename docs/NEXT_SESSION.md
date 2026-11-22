# Next session: after the V1 release (written 2026-11-22 by the lead)

Read this first. Rules still apply (`CLAUDE.md`, `docs/AGENT_RULES.md`). Agents on model `opus`. The owner watches
live tests; test fast, real input, and before any on-screen step check nobody else is using the PC
(`GetLastInputInfo`; an earlier run closed two of a person's game windows by mistake). Helpers used in the live
test: `D:\dotDock\.claude\tmp-qa\` (act.ps1, probe.ps1, state.ps1, idle.ps1, setwp.ps1, lib.sh).

## Where things stand

- **v1.0.0 is published** (GitHub release with installer, .sig, portable exe, latest.json). Website live at
  https://dotdock.vercel.app, download data filled in, "In version 1" labels. Release notes match what ships.
- **v1.0.1 tagged** (`8ed2bb3`): the dock's status area opens Windows Quick Settings (verified live: Wi-Fi,
  Bluetooth, brightness, volume); Quick settings tile shows on/off as solid/plain discs; CI green on Windows Server
  (calendar tests skip without the calendar service; url 2.5.9). The Release run was in progress
  (`gh run view 45018373437`). When it is green: `gh release edit v1.0.1 --notes-file docs/release-notes/v1.0.1.md`,
  then `cd website && node tools/release-data.mjs`, commit, push `main` (deploys the site), check the download page.
- Live test record: `docs/QA/v1-live.md` (19 of 19 regression checks, 19 bugs fixed). Decisions D-043 (held tiles:
  currency, wind, weather, contacts).

## Owner requests, in order

1. **"Settings opens then freezes."** Not yet reproduced. `settings_open` was made async (`f76f3fa`) after it
   deadlocked the main thread from the home screen toolbar. Find which path still freezes: tray menu "Settings",
   second launch, Ctrl+Alt+S, dock "Customise the dock" > open Settings, and any page action. Look for other
   synchronous commands that block the main thread (`grep -A2 "#\[tauri::command\]$"` in `src-tauri/src`) and for a
   page that busy-loops. Test each path live, confirm the core still answers (`invoke("dock_ready")` < 1 s).
2. **Make the owner's current setup the default for new installs.** Captured in `docs/defaults-from-owner/`:
   `home-storage.json` (localStorage of the home screen: `dotdock/layouts/work`, `dotdock/settings`, themes),
   `dock.json` (dock settings: tiles clock, system, media, history, toggles; icon 48; magnification; dock theme
   `obsidian`), `island.json` (notch settings). Turn these into the shipped defaults (`DEFAULT_SETTINGS` in
   `src/dock/store.ts`, `src/lib/native/dock.ts`, `protocol.rs` `DockSettings::default`, `DEFAULT_THEME` in
   `src/dock/theme.ts`, the home layout seed and theme defaults in `src/widgets`/`src/lib/theme`). Do NOT ship the
   owner's photo (the photo widget's picture is in IndexedDB; ship the widget empty) or anything personal. Keep
   positions relative to a 1920 x 1080 work area and check other resolutions place them without overlap.
3. **Notch must work.** It shows activity only after Claude Code is connected: Settings > Notch > Agents > Claude
   Code > Connect (adds dotDock's hook to `~/.claude/settings.json`; the rules forbid the agent from editing that
   file, so the owner presses Connect). After connecting, verify live with a real Claude Code turn that the island
   animates (thinking, reading, running, done). If it does not, debug `island_host.rs` / the hook exe path in the
   installed app.
4. Ship these as v1.0.2 the same way: branch, PR (CI runs on PRs), live test, merge, bump versions everywhere
   (package.json, tauri.conf.json, every Cargo.toml), tag, release notes, release-data, push.

## Owner must know

- Back up `%LOCALAPPDATA%\dockDock\release\dotdock-updater.key` off this laptop (losing it breaks all updates).
- The installer is unsigned (SmartScreen warns once).

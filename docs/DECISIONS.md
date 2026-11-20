# Decisions

Each entry: decision, alternatives, why, how to reverse.

## D-001 Project root is `D:\dotDock`, app name `dotDock`
- **Decision:** The spec says `D:\dockDock`; the real folder and GitHub repo are `dotDock`. Use `dotDock` everywhere (folder, `APP_NAME`, app-data dirs). The user-visible product name still comes from one branding constant.
- **Alternatives:** Rename the folder to match the spec.
- **Why:** The owner already created the folder and the remote `nAItiklearn/dotDock`.
- **Reverse:** Change `APP_NAME` in `branding.ts` / `branding.rs` and `tools/lib/WinShell.psm1`.

## D-002 Reference images stay out of git
- **Decision:** The owner's reference screenshots, the wallpapers in them and the mp4 are gitignored. The remote repo is public.
- **Alternatives:** Commit them under `design/reference/`.
- **Why:** They are third-party art (Nothing, NThing UI wallpapers by Runixe786). Publishing them would break spec section 17.
- **Reverse:** Remove the patterns from `.gitignore`. Not recommended.

## D-003 Push to the remote after every feature or hourly
- **Decision:** The spec says "no remote push required". The owner asked in person to push hourly or when a feature is done, to `origin main`.
- **Why:** A live owner instruction overrides the spec default.
- **Reverse:** Stop pushing. Commits stay local.

## D-004 Licence GPL-3.0-or-later
- **Decision:** Spec default. Owner can override.
- **Reverse:** Replace `LICENSE` and the notice in `README.md`.

## D-005 MSVC builds only in GitHub Actions; local builds use the GNU toolchain
- **Decision:** Release/installer builds run in GitHub Actions (`windows-latest`, MSVC). Locally: `rustup override` to `stable-x86_64-pc-windows-gnu` in `apps/desktop/src-tauri`, with WinLibs gcc first on PATH (`tools/env-gnu.sh`).
- **Why:** VS Build Tools cannot install on the owner's laptop: the Windows Installer service is unavailable (bootstrapper exit 8012, `MsiAvailabilityCheck`). Fixing a system service is out of scope.
- **Consequence:** the lib crate is `rlib` only (a `cdylib` overflows the MinGW export table, "export ordinal too large"). Local GNU builds warn about duplicate manifests; MSVC CI builds are the reference.
- **Reverse:** once MSVC works locally, `rustup override unset`.

## D-006 Click-through by cursor polling instead of SetWindowRgn
- **Decision:** The overlay is click-through (`set_ignore_cursor_events`) except while the cursor is inside a widget rectangle reported by the UI. A 16 ms `GetCursorPos` poll toggles it only on change.
- **Alternatives:** `SetWindowRgn` union of widget rects (spec 8.3).
- **Why:** a window region also clips rendering, which would cut widget shadows and hover lift. Polling costs one syscall per frame and only acts when the cursor moves.
- **Reverse:** replace `desktop_host::spawn_hit_tester` with a region update on `set_hit_regions`.

## D-007 Desktop host strategy S2 first
- **Decision:** Bottom-most, non-activating tool window (`WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`, `always_on_bottom`). WorkerW parenting (S1) is not used yet.
- **Why:** Wallpaper Engine runs on this machine and owns the WorkerW layer; S2 coexists with it. Verified on the real desktop: the overlay renders above the wallpaper and below normal windows.
- **Reverse:** add S1 behind the `desktop_host` module boundary.

## D-008 Show the window on DOM commit, not on animation frames
- **Decision:** The UI calls `overlay_ready` right after React commits (fonts loaded first). The core also shows the window after a 3 s fallback.
- **Why:** a hidden WebView2 window receives no `requestAnimationFrame` callbacks, so waiting for frames before showing deadlocks until the fallback (measured: shown at 4.1 s via fallback).

## D-010 One guard thread owns the overlay's Win32 state
- **Decision:** `desktop_host::spawn_guard` toggles only `WS_EX_TRANSPARENT` for click-through (`WS_EX_LAYERED` stays set), re-asserts `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE` and bottom-most z-order every 500 ms, and re-fits the window to the primary monitor on display or DPI changes. The window is shown with `SW_SHOWNOACTIVATE`.
- **Why:** QA found (confirmed in tao's source) that the windowing library rewrites `GWL_EXSTYLE` from its own model on every `set_ignore_cursor_events`, dropping our tool-window bits, so a click could raise the full-screen overlay over the user's apps and it showed in Alt+Tab.
- **Reverse:** return to `set_ignore_cursor_events` once tao preserves foreign extended styles.

## D-011 StartupDelayInMSec only on the Run-key fallback
- **Decision:** With the logon task (the normal path) the startup delay is left at its original value.
- **Why:** the delay only applies to Run-key apps. Zeroing it with the task would only make the owner's other 22 startup apps launch sooner and compete with us at sign-in.

## D-012 Crash-loop guard counts unclean starts only
- **Decision:** Every start is recorded; a clean exit or 5 minutes of uptime clears the count. Three unclean starts within 5 minutes restore stock Windows and disable autostart. Holding Shift at launch is safe mode (no desktop changes).
- **Why:** spec 1.2. Clean exits must never trip it, or ordinary restarts would undo the user's setup.
- **Note for testing:** killing the app three times quickly (`taskkill /F`) trips the guard by design.

## D-013 Widget design decisions (from the widgets branch)
- Dot-matrix numerals are Latin digits (the glyph sets hold 0-9 and a few symbols); all other text is locale-formatted with `Intl`.
- Controls use crisp vector icons; dot pictograms are only used large, because they blur below about 28 px.
- Notes, to-do and timer persist with zustand `persist` (schema-versioned) and sync across overlay windows via the `storage` event. No extra dependency.
- Deleting a note needs two presses within 2.5 s (undo-free safety).
- The world-clock day/night dot is computed from the sun's position for a bundled list of 43 cities.
- The timer chime is synthesised with Web Audio, so there is no audio asset to license.
- Quotes are public domain (authors died before 1930), with the translator named.
- Open: the weather pictograms score 3.5/5 on the rubric and must be redrawn before G1.

## D-014 Agent Island integration choices
- Island window is hosted like the overlay: Win32 owns its extended styles (tool window, never activates, click-through toggled via `WS_EX_TRANSPARENT` only), positioned top-centre, topmost.
- System toasts are deferred: a Windows toast cannot return the user to the right terminal, so the island itself (lingering and clickable) plus its synthesised chime is the alert. Alerts are logged to boot.log meanwhile.
- Hook registered in exec form with `async` (no shell per event; Claude Code never waits), copied to the app data folder under a content hash so registered paths survive updates. No idle-pause guessing; token counts are only ever real; a `waiting` state exists for permission prompts. (From docs/ISLAND_INTEGRATION.md section 10.)

## D-015 Photo widget (owner request)
- **Storage:** the user's original file is kept byte for byte in IndexedDB (WebView2 data folder under `%LOCALAPPDATA%`), keyed by the widget's placement id. Only framing (focal point, zoom) and a revision counter go in the synced localStorage store, so every overlay window shows the same picture.
- **Quality:** the image is laid out at its final pixel size and never scaled up by a CSS transform, so zoom resamples from the original. Tones (mono, accent duotone) are filters and blending, which change colour, not resolution.
- **Instance data:** `WidgetProps` gained an optional `instanceId` (the placement id). Previews and the gallery pass none and show the empty state.
- **Picking a file:** the overlay never activates, so before opening the file dialog the widget asks the core for the foreground (`overlay_set_typing`) and releases it on choose or cancel. The overlay's Tauri drag-drop handler is off so a photo can be dropped from Explorer.
- **No automatic clean-up in v1:** a removed widget's photo stays in IndexedDB. Pruning safely needs every profile's and every monitor's placement ids, and a wrong prune would delete a photo the user still uses; wasted disk is the safer failure. Revisit when the layout repository can list all ids.
- **Rubric:** 4.5 (composition 4.6, fidelity to the owner's reference 4.5, finish 4.5, interaction 4.6), so it is offered in the widget panel.

## D-016 Weather and quote stay below the bar for v1
- Merged the redrawn weather pictograms and the typographic quote layout, then scored them in the gallery on 2026-11-19.
- **Weather 4.0:** the 3x1 pill truncates the condition ("Partly clo…"), the pictogram is small and soft at pill size, and in the range circle it crowds the ring.
- **Quote 4.2:** the card is strong, but the 2x2 circle truncates the author ("BENJAMIN FRANKL…").
- Both stay in `BELOW_BAR` (`apps/desktop/src/overlay/catalog.ts`): their code ships, but they cannot be added until they reach 4.5.

## D-017 Six wallpaper styles reworked or added from owner-supplied mood images
- **Decision:** `louver-silver` (Brushed Blinds, now with a creased sheet and thin light arcs) and `soft-mono` (renamed Petal Haze: out-of-focus petals, thorn stems; same id) were reworked, and four styles were added: `bloom-dots` (Lattice Bloom), `meadow-dots` (Wind Meadow), `flute-flower` (Reeded Violet), `halftone-ridge` (Screen Ridge). Each has a dark and a light variant in `assets/wallpapers`, thumbnails in `assets/web/wallpaper-thumbs`, and entries in `manifest.json` (the app's wallpaper picker reads that file, so no app code changed).
- **Provenance:** all six are original procedural work in `tools/wallpaper-gen`, inspired by the mood, composition and technique of images the owner supplied (phone wallpapers and two desktop mock-ups). Those images were only looked at. They were not read by the generator, traced, sampled or resampled, and no text, characters or artwork from them appear. Every pixel comes from maths and a fixed seed (`seed` in the manifest), so the output is reproducible.
- **Layout:** every style keeps the left third calm for the clock and widgets (soft, dim or empty there) and recomposes the references for 16:9.
- **Alternatives:** trace or re-colour the references (rejected: third-party art, spec section 17); a separate generator per style (rejected: shared `core.py` helpers and `flora.py` petal geometry keep the code small).
- **Reverse:** remove the style ids from `MODULES` in `wpgen/registry.py` and re-run the generator with `--out assets/wallpapers`; delete the matching files and manifest entries.
- **Polish pass:** `halftone-ridge` got a pyramid-summit skyline with slope-following snow and rock, hazy distant ranges, layered hills with value steps, and a coarser deliberate dot screen (pale dots in the sky and snow, ink dots in the hill shadows); `louver-silver` got a crisp fold and thinner, brighter arcs with a small bloom; `soft-mono` got real petals (tapered tips, curl, uneven flanks, translucent overlaps, blur that grows with distance). All three keep the clock side flatter and lower in contrast.

## D-018 Taskbar restore: one marker, a sentinel, and recovery at start (dock milestone D0)
- **Decision:** `dock_guard::hide_for_dock` is the only way to hide the taskbar (`taskbar::hide_all` is crate-private). It requires a snapshot that holds the original auto-hide value, makes sure the sentinel is watching, writes `taskbar-hidden.json` (owner pid and start time, auto-hide just before the hide; temp file, flush, rename), then turns auto-hide on and hides until the window stays hidden. All restore paths act on that marker and remove it only after verifying the taskbar is visible and auto-hide is back: clean exit and panic hook (`restore_after_dock`, own marker only), the sentinel (`after_owner_ended`, retries up to 10 s while Explorer is away), the next start (`recover_if_dirty`, runs before the Shift check, leaves a live owner alone), and the panic button (`release`, also clears the marker). `tools/restore-windows.ps1` removes the marker first so a watching sentinel cannot disagree with it.
- **The restore target is the marker's "auto-hide before", not the snapshot's value.** The snapshot can be months old and the user may have changed the setting since; the marker holds what the user had just before the dock touched it. The snapshot is the fallback for an unreadable marker and what the panic button uses.
- **Sentinel:** `dotdock-sentinel.exe` (workspace crate `sentinel`, no Tauri, Windows subsystem) waits on the core's process handle. Start is two steps: `launch` starts `watch` detached (new process group, out of the caller's job when allowed) and exits, so the watcher is not a child of the core and survives `taskkill /F /T`. One watcher per pid, enforced by a named mutex that the core also uses to see whether its watcher is alive; the core re-checks every second and restarts it. The watcher acts only on a marker owned by the pid it watched.
- **Started lazily by `hide_for_dock`, not at app start.** A user who never replaces the taskbar gets no extra process. `hide_for_dock` fails, and hides nothing, if the sentinel cannot be started.
- **Where the sentinel exe lives:** next to `dotdock.exe`. Tauri's build script requires every configured resource and `externalBin` file to exist for every build of the app (clippy and tests included), so it cannot be named in `tauri.conf.json`. The CI `bundle` job and the release workflow build it first and bundle it through the merge file `src-tauri/tauri.sentinel.conf.json` (`pnpm tauri build --config`). When the file is missing (the portable exe, a dev run, a broken install) the same code runs from `dotdock.exe --sentinel`, so the guarantee does not depend on bundling.
- **Measured on this machine:** Explorer re-shows the hidden taskbar window about 50 ms after an auto-hide change, and `SHAppBarMessage(ABM_SETSTATE)` blocks about 450 ms when the value actually changes. Hence the hide-until-stable loop and the 1 s settle in restores.
- **Alternatives rejected:** only restoring on clean exit and at next start (leaves a hidden taskbar after `taskkill /F` until the user restarts dotDock); starting the sentinel from the core as an ordinary child (a tree kill takes it along); a sentinel that is only a separate exe (the portable exe and dev runs would have no watchdog, so the same code also runs from `dotdock.exe --sentinel`).
- **Not covered:** sign-out and shutdown end the sentinel and the core together; Explorer rebuilds a visible taskbar at the next sign-in, and `recover_if_dirty` puts auto-hide back at the next dotDock start. Until then auto-hide can stay as the dock set it.
- **Reverse:** drop the hide path (the dock simply floats over the native taskbar); the marker and sentinel are inert without it.

## D-019 Native tile providers: one core API for the dock UI, with the UI's own wire (tiles track)
- **Decision:** `dotdock-tiles` serves the dock UI through `DockTiles` (`dock.rs`), which speaks the wire the dock UI branch defined in `tiles/ui-types.ts` and `tiles/backend.ts`: seven feeds (`contacts`, `meeting`, `stopwatch`, `mic`, `hydration`, `agenda`, `audio`), each `{ data, issue }`, delivered on `dock://tiles` as a partial update; the live mic level on `dock://mic-level`; and six commands (contact, join meeting, stopwatch, toggle mic, hydration, audio). `wire.rs` holds those shapes and the pure mapping from provider states; it is tested against the JSON the UI expects. The first-wave tiles of the UI use this. The second-wave tiles (clipboard, screenshots, downloads, shelf, toggles, system history, voice memo, colour picker) have no UI yet and keep the generic `TileHub` protocol (`protocol.rs`, mirrored and parity-tested against `tilesProtocol.ts`).
- **The core owns the stopwatch and the water log**, as the UI contract says ("nothing is computed by the UI that the core knows better"): `stopwatch.rs` and `hydration.rs` keep their state in the tiles data folder (`stopwatch.json`, `hydration.json`, written through a temp file and a rename, and only changed in memory after the write succeeded). The stopwatch counts from a Unix start time, so it keeps counting across a restart. The water log starts a new local day at midnight; the reminder window (8:00 to 22:00), interval (60 min), goal (2000 ml) and glass (250 ml) are constants, because the UI has no command to change them and an unused setting would be dead code. The reminder time is only reported; showing the notice is the UI's job.
- **Issues the core produces:** `no-device` (no playback or capture device), `needs-setup` (the Windows calendar has no events and no account), `error` (a provider would not start or a read failed). `unsupported` is the UI's word for a core that predates a feed, and `offline` belongs to network feeds, which the core has none of.
- **Not committed from the earlier session:** `apps/desktop/src/dock/tiles/models/*` (TypeScript stopwatch, hydration, progress, reminders, focus and world-clock models). The UI branch computes progress, focus and reminders itself, and the core owns the stopwatch and the water log, so those files had no consumer.
- **Process-wide MTA:** the MTA is kept alive for the whole run (`CoIncrementMTAUsage` in `com.rs`). Without it, Windows tore the apartment down when the last worker ended, the `windows` crate's cached WinRT factories died with it, and the next calendar start crashed in `RequestStoreAsync` (reproduced with a test, `calendar::store`).
- **Tests that play a sound** (microphone meter, voice memo recording) are `#[ignore]`d and run with `cargo test -p dotdock-tiles -- --ignored`: they play a system sound through the speakers and listen to its loopback, which is audible and takes the one process-wide `PlaySound` slot. They refuse to run while the output is muted (loopback is silent then), start the sound before the loopback stream opens, and the recording test tries up to three times, because on this laptop's driver a loopback stream stays silent about one try in six.
- **Reverse:** drop `dock.rs`, `wire.rs`, `stopwatch.rs`, `hydration.rs` and `zone.rs`; `TileHub` still works on its own.

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

## D-019 Logo: a dot docked in a pill, drawn from code (brand track)
- **Decision:** the mark is a red dot nested in a socket cut from a tall ivory pill. It reads as a lowercase `d` (dot, dock) and is the `d` of the Doto wordmark with its dots fused. The geometry lives once in `tools/brand-gen/mark.py` on a 96 unit tile with a 4 unit lattice (dot radius 24, pill 24 x 72, gap 4, socket reach 4). `tools/brand-gen/build.py` generates every asset from it: the Tauri icons (`icon.ico` with a real drawing at 16, 20, 24, 32, 40, 48, 64, 128 and 256 px; the PNGs `tauri.conf.json` lists), `website/public/favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `website/src/components/Mark.astro`, and `brand/` (logo SVGs, wordmark, 1280 x 640 social preview, the images in `brand/README.md`). It replaces `tools/icon-gen/make_icon.py` (the 3 x 3 dot grid, which read as a generic app-grid icon).
- **Why this one:** ten concepts were drawn at 256, 64, 32 and 16 px on dark, light, gold and one colour (`brand/exploration/round1-*.png`). Only the docked `d` stayed instantly readable at 16 px, survived one colour, and said both "dot" and "dock" with two shapes the whole UI already uses (circle, pill). Rounds 2 to 4 tested variations (ring bowl, inverse colours, a trail, a perforated pill, a dot-field backdrop, proportions) and settled the socket depth, pill width and gap.
- **Rejected:** dock grid (apps over a pill: read as a keyboard); drop (a dot falling into a slot: read as a joystick); fisheye row (magnified dock: dissolves below 32 px, looks like loading dots); orbit (ring and moon: generic target); cradle (dot and a U: read as a smiley); lift (one raised dot: no silhouette); hex cluster (seven dots: a flower, no link to dock); D tile (D-shaped silhouette with a 2 x 2 lattice: read as a face or a chat bubble); seat (dot on a long pill: read as a hat); docked d with a ring bowl (open counter but reads as a target); with a trail (clutter, vanishes at 16 px); inverse (red pill: reads as an alert bar); perforated pill (reads as a speaker grille); dock of dots (a column of three dots: lost the `d`).
- **Not derivative:** no letterform in dot-matrix as the mark, no segmented ring, no Ndot-style glyphs. The mark is flat geometry; dot-matrix craft is in the wordmark (Doto, SIL OFL 1.1, one SVG circle per dot) and in the 4 unit lattice. Colours are the project's own theme tokens.
- **Small sizes are redrawn, not scaled:** 16 to 32 px have whole-pixel edges and a 1 to 2 px gap (`PIXEL_SIZES` in `mark.py`); 16 px drops the socket because a 1 px curve only smears. The dark tile carries a faint hairline from 48 px up because it is only 1.16 : 1 against a dark taskbar; below that the dot (4.1 : 1) and the pill carry the identity.
- **Tray:** `tray.rs` asked for `default_window_icon()`, which on Windows is the large-icon size (32 px at 100%) that Windows then shrinks to 16. It now loads the small-icon size (`SM_CXSMICON`) from the embedded `.ico` and falls back to the old icon, so the hand-drawn 16, 20, 24 or 32 px drawing is used as is. `cargo check` is clean on the local GNU toolchain.
- **The name is not baked in:** the generator reads `PRODUCT_NAME` from `apps/desktop/src/lib/branding.ts`, so a rename is one edit there and a re-run. The mark itself is a `d`; a rename to a name that does not start with `d` would need a new mark.
- **Accent follows the theme:** the website nav mark paints the dot with `--accent` and the pill with `--text` (red in Obsidian and Paper, gold in Aurum). The dot slides into its socket once on load (`--dur-slow`, none under reduce-motion).
- **Not done:** no `og.png` for the website (the existing alt text describes a desktop screenshot, so a logo card would mislabel it; `brand/social-preview.png` is for the GitHub repository card). The mark has not been tested on real users.
- **Reverse:** `git revert` the commit; `tools/icon-gen/make_icon.py` returns with it and nothing else depends on the new files.

## D-020 Dock backend (`dotdock-dock`): what was decided while building it (dock milestone D1/D2)
Numbered D-019 because D-017 and D-018 exist on `main`; the backend track's branch is based earlier, so renumber on merge if another track took the same number.
- **Module name `running`, not `windows`.** The window list lives in `dock/src/running`. A module called `windows` would shadow the `windows` crate in every `use windows::...` of the crate root.
- **Catalogue merge keys.** Two entries are one app when they share an AppUserModelID, a target and arguments, the same normalised name and program, or one Store package and name. Shortcuts that start one program with different arguments (Vim and Vim Diff, Chrome web apps) stay separate. The id is the AppUserModelID when the app has an explicit one, else the normalised target; the shell's invented ids (`{GUID}\path.exe`, `Microsoft.AutoGenerated.{GUID}`) are never used as an id.
- **Why AppsFolder and the Start menu are both read.** AppsFolder is the only source of Store apps and of the AppUserModelIDs desktop apps use for their windows; the Start menu scan supplies the shortcut (launch path, custom icon, folder name for the classifier). Reading shortcuts needs a fresh `IShellLinkW` per file: a reused object leaks the previous file's AppUserModelID into the next.
- **Classifier order matches DOCK_SPEC 5**: user, bundled table, package-identity rules (`FiledBy::Store`), then folder, publisher and name keyword rules (`FiledBy::Rule`), then Other. No Store category exists offline, so `Store` means "from the package's identity". Terminals: Windows Terminal, Git Bash, PowerShell 7 and WSL are Development; Command Prompt and the Windows PowerShell shortcuts are System. The brief's "Terminal if not dev" would make an icon move when another app is installed, so it is a fixed rule. Accuracy and judgement calls: `docs/spikes/DOCK_CLASSIFIER.md`.
- **Icons are never upscaled in the cache, except small native icons.** The shell hands back a 32 or 48 px icon as a dot in the middle of a 256 px canvas; those are cropped and enlarged with a bicubic resample so they fill the cell like the others (`Rgba::enlarge_small_native`). A desktop app's icon is read from its shortcut only when the shortcut names an icon file that exists, otherwise from its program, because a shortcut whose icon file was uninstalled shows the blank page. PNG is encoded at the `Fast` level: 14 ms instead of 34 ms per icon, 8.4 MB instead of 6.5 MB for 214 icons.
- **Cache key and URL.** `dock-icon://<16 hex>.png`, the hash is FNV-1a over id, the modification time of the source, the extractor version and the size. `key_from_url` accepts exactly that shape, so a crafted URL cannot name a path outside the cache folder.
- **Nothing polls.** Window changes come from `SetWinEventHook` (foreground, minimise, destroy, show, hide, name change, cloak; deliberately not `EVENT_OBJECT_LOCATIONCHANGE`, which fires for every mouse move) and the shell hook (flash, create, destroy, activate). Events only mark the list dirty; a one-shot timer armed by the first event and killed when it fires (40 ms debounce, at least 250 ms between recomputes) wakes the worker. The catalogue is rescanned only on Start menu change notifications (`notify`) and on changes of the per-user package list (`RegNotifyChangeKeyValue`), coalesced after 1.5 s of quiet. Every thread sleeps in `recv`, `GetMessage`, a condition variable or `WaitForMultipleObjects`.
- **Warm start does not scan or extract.** The last scan is cached in `catalogue-cache.json` with a fingerprint (the Start menu shortcut list with sizes and times, plus the package list's key count and last write time). A matching fingerprint skips the scan; icons are found by name.
- **Frozen signal.** `FrozenState { locked, displayOff, fullscreen }` from session lock (`WTSRegisterSessionNotification`), display power (`GUID_CONSOLE_DISPLAY_STATE`) and `SHQueryUserNotificationState`, re-queried on foreground changes, restores and display changes. It is delivered as `DockEvent::Frozen` (event name `dock://frozen`). This event is **not yet in `protocol.ts`**; it is additive, and the integration step adds `"dock://frozen": FrozenState` to `DockEvents`. The UI track must not assume it exists until then.
- **Persistence.** `dock.json` (settings, categories, the user's filings, first-seen times) and `catalogue-cache.json` are written atomically (temporary file renamed over the old one) and at most once per second; a file that does not parse is kept as `.bad`, never overwritten. Apps present at the very first scan get `firstSeen = 0`, so only apps installed later are "new".
- **App bar and thumbnails are spikes behind explicit calls.** `AppBar::register` is only called from `examples/appbar_probe.rs`; its guard removes the bar on `Drop`. Thumbnails are `DwmRegisterThumbnail` into the host window, laid out by pure arithmetic (`thumbnail::layout`). Nothing in `DockService::start` hides the taskbar or registers a bar.
- **Tests that hide the taskbar** (allowed by the owner for this milestone) hold a guard that shows it again and restores the auto-hide state, plus a panic hook for the release profile (which aborts and never runs `Drop`).
## D-024 Native tile providers: one core API for the dock UI, with the UI's own wire (tiles track)
- **Decision:** `dotdock-tiles` serves the dock UI through `DockTiles` (`dock.rs`), which speaks the wire the dock UI branch defined in `tiles/ui-types.ts` and `tiles/backend.ts`: seven feeds (`contacts`, `meeting`, `stopwatch`, `mic`, `hydration`, `agenda`, `audio`), each `{ data, issue }`, delivered on `dock://tiles` as a partial update; the live mic level on `dock://mic-level`; and six commands (contact, join meeting, stopwatch, toggle mic, hydration, audio). `wire.rs` holds those shapes and the pure mapping from provider states; it is tested against the JSON the UI expects. The first-wave tiles of the UI use this. The second-wave tiles (clipboard, screenshots, downloads, shelf, toggles, system history, voice memo, colour picker) have no UI yet and keep the generic `TileHub` protocol (`protocol.rs`, mirrored and parity-tested against `tilesProtocol.ts`).
- **The core owns the stopwatch and the water log**, as the UI contract says ("nothing is computed by the UI that the core knows better"): `stopwatch.rs` and `hydration.rs` keep their state in the tiles data folder (`stopwatch.json`, `hydration.json`, written through a temp file and a rename, and only changed in memory after the write succeeded). The stopwatch counts from a Unix start time, so it keeps counting across a restart. The water log starts a new local day at midnight; the reminder window (8:00 to 22:00), interval (60 min), goal (2000 ml) and glass (250 ml) are constants, because the UI has no command to change them and an unused setting would be dead code. The reminder time is only reported; showing the notice is the UI's job.
- **Issues the core produces:** `no-device` (no playback or capture device), `needs-setup` (the Windows calendar has no events and no account), `error` (a provider would not start or a read failed). `unsupported` is the UI's word for a core that predates a feed, and `offline` belongs to network feeds, which the core has none of.
- **Not committed from the earlier session:** `apps/desktop/src/dock/tiles/models/*` (TypeScript stopwatch, hydration, progress, reminders, focus and world-clock models). The UI branch computes progress, focus and reminders itself, and the core owns the stopwatch and the water log, so those files had no consumer.
- **Process-wide MTA:** the MTA is kept alive for the whole run (`CoIncrementMTAUsage` in `com.rs`). Without it, Windows tore the apartment down when the last worker ended, the `windows` crate's cached WinRT factories died with it, and the next calendar start crashed in `RequestStoreAsync` (reproduced with a test, `calendar::store`).
- **Tests that play a sound** (microphone meter, voice memo recording) are `#[ignore]`d and run with `cargo test -p dotdock-tiles -- --ignored`: they play a system sound through the speakers and listen to its loopback, which is audible and takes the one process-wide `PlaySound` slot. They refuse to run while the output is muted (loopback is silent then), start the sound before the loopback stream opens, and the recording test tries up to three times, because on this laptop's driver a loopback stream stays silent about one try in six.
- **Reverse:** drop `dock.rs`, `wire.rs`, `stopwatch.rs`, `hydration.rs` and `zone.rs`; `TileHub` still works on its own.

## D-026 CoolDock-gap tiles: where each one's data comes from (dock UI, 2026-11-21)
- **Sun arc** computes sunrise and sunset locally (sunrise equation, within a few minutes) for a bundled city. It
  follows the city in the device's own time zone unless the user picks one; no location permission, no network.
- **Wind** reads optional `windKmh`, `windFromDeg`, `gustKmh` on the weather provider. Until the core fetches them the
  tile says "Not available" rather than guessing (blocker B-002).
- **Currency** reads a new `rates` tile feed (European Central Bank reference rates, cached by the core so it works
  offline). Not a field of the unit converter: rates change and have a source date, units do not.
- **Web search** opens addresses through a new `dock_open_url` command that accepts http(s) only; a typed site opens
  directly. Engines: DuckDuckGo (default, no account, no tracking), Google, Bing, Ecosia, Brave.
- **History** is the dock's own record of apps it opened (launches that succeeded), newest first, on this device only.
  CoolDock's history is browser history; reading another app's history is out of scope for a local-first dock.
- **Voice memo** records with the WebView's microphone access and keeps audio in this device's IndexedDB, at most 12
  memos and 10 minutes each, with a 40-bar peak waveform per memo. Nothing is uploaded.
- **Flip clock** is a face only: a new minute mounts a new card whose top folds once (none with reduced motion).

## D-027 The dock's first layout is made once from the user's own apps (2026-11-21)
A dock with nothing pinned shows only the running apps, which the owner read as broken ("only 2 of my apps").
After the first catalogue with apps, an empty dock (no pins, no tiles) gets a starter layout: File Explorer, one
browser (Chrome, Edge, Firefox or Brave, first installed), Terminal, VS Code or Cursor, Spotify or Media Player,
Settings, then up to four stacks for categories with three or more apps, and the clock, media and system tiles
(they need no account). A `laidOut` flag in `dock.json` makes it run once, so a user who later removes everything
keeps the empty dock. Code: `dock/src/starter.rs`.

## D-028 The catalogue leaves out duplicates and modes of another app, and says why (2026-11-21)
Same-name entries are merged into one (the Start menu one wins and takes the package's publisher), and an entry
named "<app> <more words>" that starts the same program as <app> is left out. Every dropped entry carries a reason;
`catalogue_probe --removed` prints them and `docs/QA/dock-live/catalogue.md` lists them for this machine.
Installers that are real apps (Visual Studio Installer, MySQL Installer) stay: they work and the user may need them.

## D-029 The dock lives at the bottom only (owner, 2026-11-21 11:35)
The dock replaces the taskbar, so it sits at the bottom, centred, on the primary monitor. The host has no other
edge: the app bar is always `ABE_BOTTOM`, the window ends at the bottom of the work area or the granted strip, and
the plan reserves a strip or not. `DockSettings.edge` stays on the wire for the UI, but the service puts every
loaded or saved setting back at the bottom (`at_the_bottom`), so an old file or a stale control cannot move it.
Setting the dock by hand also marks the first layout as done, so it never replaces the user's choice.

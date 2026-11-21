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
- **Update (2026-11-20): sizes, borders and shapes.** Owner request: different border and size options, fully customizable. QA and scores: `docs/QA/photo-frames.md`.
  - **Where the options live:** in the widget's own settings (`PHOTO_SCHEMA`), which are stored per placement id in the layout and edited through the existing per-widget settings panel, so they get live preview on the desktop, undo, per-profile layouts and a copy when a widget is duplicated. The photo store keeps only what is not a setting: framing and the file revision. Moving them into the photo store was rejected: the panel is generated from the schema, and a second store would need its own undo and sync.
  - **Sizes:** eight footprints (Large 4x4, Medium 3x3, Small 2x2, Wide 4x2, Landscape 4x3, Tall 2x4, Portrait 3x4, Panorama 6x2). The four t-shirt ids saved layouts hold (`l`, `s`, `m`, `xl`) keep their footprints; `SizeId` gained `medium`, `landscape`, `tall`, `panorama`. Edit mode snaps a corner resize to the nearest declared footprint, so there is no free pixel resize (the grid is whole cells by design); the longer list is the ladder the handle climbs, and the size list in the panel and the Widgets page becomes a select with cell counts above four sizes (`SizePicker`).
  - **Resize keeps the framing:** framing is a focal fraction and a zoom over the cover size, never pixels, so it is re-applied to the new frame and the photo always covers its window (tested at every footprint). The widget applies a resize before the next paint (`flushSync` in the observer) so the old size is never drawn in the new frame.
  - **Borders:** edge to edge, keyline (a hairline at the widget's edge with air inside), paper mat, polaroid (foot four times the sides, caption typed by the user, mono caps), dot matrix (a ring of dots, one cell deep, whole cells on every side, corner dots a rounded corner would cut are left out; on a circle the dots are spaced evenly along the ellipse). Width 4 to 32 px, colour paper / ink / grey / accent from tokens, mask rounded / squircle (`corner-shape`, plain rounded where the engine lacks it) / circle, corner radius 0 to 40 px, shadow switch. A border is capped so the photo keeps half the widget on each axis. A polaroid is always a rounded rectangle (a mask would cut the caption).
  - **Defaults are the old look:** edge to edge, rounded at `--radius-lg`, 12 px (`--space-3`) width, paper, shadow on. The old two-way `mat` setting is read as the new `frame` (`replaces: "mat"`), so an old mat becomes the Mat border at the same width and colour. A test reads `tokens.css` to keep the defaults equal to the tokens.
  - **Schema extensions (data only, so a third-party widget can use them):** `appliesWhen` (show a field only for some values of other fields), `replaces` (read a renamed setting), `swatch` on an enum option (colour chips from a token). Forms also wrap a control that does not fit beside its label.
  - **Not done:** a border change is instant (no morph); the first time a 24 MP photo is shown at a new decode scale the browser takes about 130 to 165 ms once (measured; later resizes hold 60 fps).

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

## D-021 The dotDock environment runs as one unit, with two switches (modules track, owner direction 2026-11-20)
Numbered D-021 because D-020 is the last on this branch; renumber on merge if another track took it.
- **What changed.** The first version had a switch per part (home screen, dock, taskbar replacement, notch) on its own Settings page. The owner dropped that: per-part switches invite problems, and the aim is for people to use the whole environment. The page, its store and its tests are gone. The lifecycle manager stayed, because the two remaining switches and a clean shutdown need it.
- **The two switches** (Settings, Startup & Windows page, last section "Advanced", component `settings/ui/EnvironmentSwitches.tsx`; it moves into the last group of the reorganised Settings as is):
  1. **Use the dotDock desktop.** Off stops every part, in reverse start order, restores the real taskbar and leaves plain Windows. The app stays alive in the tray, so it can be switched back on. Wallpaper and desktop icons are not touched (that is "Restore Windows desktop"). Saved, so a restart stays off.
  2. **Use the Windows taskbar.** Off by default. On stops only the taskbar replacement and restores the real taskbar; the dock keeps running. When this build has no replacement (the dock host is not merged yet) the switch reads "on" and is disabled, with a line that says why.
- **Taskbar replacement defaults to on** (once a dock host registers one). Hiding the Windows taskbar is a bigger step than adding a dock, which is why the first version defaulted to off; with "Use the Windows taskbar" as the opt-out the product is the whole environment, so the replacement is the default. The restore guarantees of D-018 are unchanged and run whenever the replacement stops or fails to start. To go back to opt-in, change `Choices::default` in `shell/src/modules.rs` to `windows_taskbar: true`.
- **Where the state lives.** `modules.json` in `%LOCALAPPDATA%\dev.dotdock.desktop` (`{schema, environment, windowsTaskbar}`, written to a temporary file, flushed, renamed). The core reads it before any window exists, which the webview's localStorage cannot offer. A missing, damaged or newer file means the defaults.
- **The plug-in contract for the dock host** (`dotdock_shell::modules`, no UI framework, 23 unit tests plus 8 for the run gate):
  - Implement `Lifecycle { start() -> Result<(), String>; stop() }` for the dock and for the taskbar replacement and register them in `modules_host::start_enabled` with `modules.register(ModuleId::Dock, Box::new(..))` and `ModuleId::Taskbar`. A part registered while the environment is on starts at once, in start order Home, Dock, Taskbar, Notch.
  - `start` must leave nothing behind when it fails, and `stop` must free every window, thread and Windows setting. The manager calls each only in the right state.
  - The taskbar replacement starts only after the dock runs and stops before it. Whenever it stops, or its `start` fails, the manager also calls `dock_guard::restore_after_dock`, whatever the lifecycle did. The lifecycle itself should still use `dock_guard::hide_for_dock` to hide.
  - Windows are created and destroyed off the main thread (`lifecycle::destroy_window` waits for the label to be free so a part can start again at once). Never take the manager's lock from a main-thread callback.
- **Commands and events.** `environment_get`, `environment_set { on }`, `taskbar_set { useWindows }`, event `environment://changed` with `{on, windowsTaskbar, taskbarReplacement, problems}`. `problems` lists parts that were meant to run and did not, in words (for example the notch without a Claude folder), shown under the first switch.
- **Home screen stop/start.** `Home` owns the overlay window, the desktop guard thread and the three provider threads; they all sleep on one `RunGate`, so stopping wakes them at once; each thread is joined (5 s patience, logged) and the window destroyed. `Notch` drops its service (joins the monitor thread) and poller (now joins its thread) and destroys the window. Settings previews therefore show live data only while the home screen runs.
- **The app now stays alive with no window.** Closing the last window used to quit; `RunEvent::ExitRequested` without an exit code is prevented, so the tray keeps dotDock running when the home screen is off and Settings is closed. Tray entries that only mean something with the home screen are greyed out while it is off.
- **Alternatives rejected.** Keeping per-part switches behind an "expert" flag (still a way to break the environment); storing the choice in the settings document (not readable before the webview); a dedicated last page (the Settings reorganisation owns the shell and sidebar).
- **Reverse.** Delete `EnvironmentSwitches` and the two commands; the manager then runs every part registered, always on.

## D-022 A theme from the user's own wallpaper (modules track)
- **Source.** The wallpaper Windows is showing on the primary monitor (`IDesktopWallpaper::GetWallpaper` for the monitor at the origin of the virtual screen), or any picture the user chooses. The core hands the webview the raw file bytes (`wallpaper_current_image`; the path is Windows' own answer, never the caller's; files over 64 MB are refused before reading; a solid colour is reported as such). The webview decodes and shrinks it (`createImageBitmap`, 64 px longest side), so no image codec is added to the core. If Wallpaper Engine paints over the desktop, the Windows wallpaper underneath is what is read.
- **Palette** (`lib/theme/palette.ts`, pure, deterministic): pixels in OKLab, k-means with farthest-first seeding (8 groups, at most 4096 samples), groups ranked by share. Accent candidates are groups with OKLCH chroma of at least 0.05 and at least 1 % of the picture, ranked by chroma damped below 5 % share, one per 25 degrees of hue, at most four. The user picks among them.
- **Mapping** (`lib/theme/wallpaperTheme.ts`): the accent and the faint tint of every surface come from the picture (the backdrop's hue, and as much of its chroma as stays quiet: up to five times the ramps' own); lightness comes from the built-in neutral ramps, not the picture, because contrast depends on it. Light or dark follows the picture's mean lightness (halfway between the two built-in backgrounds), or the user's choice. A picture with no colour keeps the theme's own accent (Obsidian's or Paper's red) and neutral surfaces.
- **AA guarantee.** Text, secondary text, warning and good colours must reach 4.5:1 on the background, the card (the translucent surface composited over the background) and the raised card; the label on the accent 4.5:1; the accent itself 3:1 on the background and card. A colour that fails moves along the lightness scale in 1/256 steps, away from the surface, and stops at the first value that passes, so it moves as little as possible and keeps its hue and chroma. Every check runs on the stored 8-bit colours. Found while testing: Paper's red (#e2363d) and similar mid-tones cannot carry a 4.5:1 label with either white or the near-black ink, so those accents are deepened or lightened slightly and Settings says so. A sweep of 432 flat pictures (hue, saturation, lightness) in both modes, and busy multi-colour pictures, all pass.
- **Apply and undo.** One custom theme with the fixed id `custom-from-wallpaper` is replaced on each apply (no pile-up; duplicate it to keep one). It becomes the single theme, or the light/dark slot of an automatic mode. Undo puts back the replaced theme (or removes the new one) and the previous choice. If the 24-theme limit is reached the user is told and nothing changes.
- **Alternatives rejected.** Median cut (less stable on gradients); decoding in Rust with the image crate (a codec dependency for something the webview already does); following the wallpaper automatically (a surprise change of the whole desktop; not asked for); using the picture's own lightness for the surfaces (breaks contrast guarantees).
- **Not done.** No automatic re-theme when the wallpaper changes; no per-monitor choice; a slideshow wallpaper is read as the picture Windows reports at that moment.

## D-023 New installs start with the Wind Meadow wallpaper (owner decision 2026-11-20)
- **Which wallpaper.** The deep green wind-swept grass with dotted white and yellow flowers in the website's Aurum preview is `meadow-dots`, "Wind Meadow", **dark** variant (`assets/wallpapers/meadow-dots-dark.jpg`, D-017). It is already in the app's wallpaper set, so nothing was ported or regenerated.
- **When.** The first time dotDock starts on a machine, `first_run::claim` runs in `setup`, before any window exists, and the default wallpaper is applied on every monitor on a background thread (`wallpaper::apply` snapshots the original wallpaper first, so "Restore Windows desktop" brings it back). The result is written to `boot.log`.
- **Never an existing user.** `first_run::claim` returns a first start only when the marker `first-run.json` is absent **and** the app data folder has none of the traces an earlier run leaves: the web view's profile folder `EBWebView` (made by the first window) and the Windows snapshot `windows-original.json` (made before the first change). Anyone who ran any earlier build has at least one, so their wallpaper is left alone and the marker is written. Boot logs and guard files made by the current start do not count. The marker is written when the decision is made, not when the wallpaper is applied, so a wallpaper the user sets later is never replaced, and a failed apply is not retried.
- **Dev and portable runs.** Without the bundled `wallpapers` resource nothing is applied (`Outcome::NothingToApply`).
- **Not changed.** The default theme stays Obsidian; the Aurum theme and the wallpaper only match in the website preview.
- **Tests.** `shell/src/first_run.rs`: the default exists in the shipped manifest as `meadow-dots`/`dark`; a fresh folder applies it exactly once; an existing user (either trace) is never touched; a later start never re-applies; a refused wallpaper is reported and not retried; a missing resource folder applies nothing; only the exact id and mode count.
- **Reverse.** Remove the `claim` call in `setup`; nothing else depends on it.

## D-024 "dotDock theme" off gives Windows back in full; on takes it over again (theme track, 2026-11-21)
Replaces the first switch of D-021, which stopped the parts but left the wallpaper and autostart alone.
- **Name and place.** The switch is "dotDock theme", in the last section "dotDock and Windows", beside "Use the Windows taskbar" (the owner's words: theme on/off). `EnvironmentSwitches` stays one self-contained component; the Settings IA track moves it to the end of its Recovery page, so on this branch it is the last section of Startup & Windows.
- **Off** (`modules_host::switch_theme`): every part stops first (reverse start order, taskbar put back), then `handover::hand_back` records what dotDock had set (each monitor's wallpaper as a private copy in `desktop-handover\`, and whether it starts at sign-in) in `desktop-handover.json`, then restores Windows with `restore::restore_windows`, the same effect as `tools/restore-windows.ps1`: taskbar shown, autostart removed, startup delay, wallpaper and taskbar auto-hide from the original snapshot. Windows is restored even if recording failed; the error is still shown.
- **On:** `handover::take_over` puts each monitor's recorded wallpaper back (a monitor added since gets the first one; one that is gone is skipped), turns launch at sign-in on again only if it was on, removes the record, and then the parts start.
- **Edge cases.** A second off keeps the first record (the screen then shows Windows' own desktop, not dotDock's). On without a record changes nothing. A damaged record fails "on" and is kept, never silently skipped. Copies are kept until the next off, because Windows may still be reading them.
- **Why copies.** Windows may report a file it later overwrites (Spotlight, slideshow `TranscodedWallpaper`), the same reason the original snapshot keeps a private copy.
- **No per-part toggles.** The island's own "Show the island" switch and its `enabled` setting are removed; an old settings file that still has `enabled` is read as before and the key ignored. Grep for per-part switches found no others.
- **Reverse.** Drop the two `handover` calls in `switch_theme`; the switch then behaves as in D-021.

## D-025 Theme-from-wallpaper is checked on real pictures (theme track, 2026-11-21)
- The 32 shipped wallpapers are shrunk to the 64 px grid the webview hands the palette (`tools/theme-fixtures/sample-wallpapers.ps1`, System.Drawing bicubic) and committed as small `.rgb` fixtures (260 KB). `wallpaperFixtures.test.ts` checks every accent candidate in both modes for AA on every text and surface pair, and that dark, light, colourful and colourless pictures are all covered.
- Pictures that are not ours (Windows' own wallpapers, the owner's reference images) are sampled into `src/lib/theme/fixtures-local/`, which is git-ignored, and the same test checks them when the folder exists: 72 pictures, all pass. They are never committed because their licences are not ours.
- Rejected: decoding JPEGs inside the test (adds an image codec dependency for tests only); a synthetic sweep alone (already exists, D-022, but real pictures have noise and gradients a sweep does not).
- **Accent held to 4.5:1 (found in the live run).** Widgets set small labels in the accent (the weekday under the date). At D-022's 3:1 the meadow's green read dim, so the accent now has to reach 4.5:1 on the background, the cards and the raised cards, as well as carry a 4.5:1 label. Obsidian's own red is lightened very slightly when it is the fallback (the hue is kept, lightness moves by less than 0.05). **Reviewer B:** on the desktop the cards sit on the wallpaper, not on the theme background, so the gate also measures text, secondary text and the accent on a card over pure black and over pure white. Obsidian's fallback red therefore moves a little further (lightness by less than 0.12, hue kept). The Startup page's "Use this desktop" switch duplicated the dotDock theme switch and is removed; "Restore Windows desktop" now sits outside the startup gate so it stays reachable when the startup state cannot be read, and is hidden in a plain browser where it could only fail. The sweep and the real-wallpaper tests run under the new rule.

## D-026 Theme switch: the user's own Windows wallpaper survives a cycle, one way back (theme track, reviewer B round 2)
- **Windows side recorded on "on".** Before dotDock's wallpapers go back, what Windows is showing is recorded (`desktop-handover.windows.json`, private copies). The next "off" restores Windows as `tools/restore-windows.ps1` does, then puts that recording back, so a wallpaper the user picked while dotDock was off is not replaced by the one from before dotDock. Used once, then deleted; if it cannot be recorded the next off falls back to the original snapshot and Settings says so.
- **Idempotent switch.** Switching to the state already saved does nothing (a second Settings window cannot restore Windows twice). A failed save of "on" hands the desktop back again, so dotDock's wallpaper and launch at sign-in are never left on with the theme off. A hand-over problem stays in every later read and event until the next switch.
- **Launch with the theme off opens Settings** (unless started at sign-in), so the switch to bring dotDock back is in front of the user rather than a tray icon only.
- **One way back.** The Startup page's "Restore Windows desktop" button is removed: it ran the restore without stopping the parts or recording dotDock's desktop, and its text promised things it did not do. The "dotDock theme" switch, outside the startup gate, is the way back in Settings; the tray, `dotdock.exe --restore-windows` and `tools/restore-windows.ps1` keep the panic restore. Search for "restore" or "panic" finds the switch.
- **The notch is not part of the run without a Claude Code folder**, so the theme switch carries no permanent warning for users who do not use Claude Code.
- **Home screen gate set before the window exists**, so a warm webview that reports ready early always opens the providers.
- D-022's 3:1 accent target is superseded by the 4.5:1 rule above.


## D-027 Dock material tokens stay with the dock themes (theme track, lead 2026-11-21)
A wallpaper or custom theme drives colour and shadow strength only. Material, translucency, radius, border and shadow of the dock are carried by the dock UI's own themes (glass, glass-lite, Obsidian, Paper, Aurum, minimal) on the dock branch. Adding them to the theme document here would add settings with no consumer on this branch. Revisit once the dock UI is merged, if a theme should switch the dock's material.

## D-028 Settings takes in the theme track, and its two switches end Settings (Settings track, 2026-11-21)
- **Why merge here.** The two switches (D-021, D-024) need the module manager (`modules_host`, `home_host`, the
  `environment_*` and `taskbar_set` commands), which only the theme branch has. Merging that branch into the Settings
  branch is the only way to put real switches, not stand-ins, at the end of Settings.
- **What was decided in the merge.** The overlay lives in `home_host` (theme track); the Settings commands stay in
  `core_commands`. "Use this desktop" (the `useOurDesktop` startup toggle and `core_prefs`/`core.json`) is gone: the
  dotDock theme switch replaces it, so there is one way to switch off, not two. The theme track's `wallpaper_apply`,
  `wallpaper_monitors`, `autostart_set` and its own `wallpapers_list`/`restore_windows` are dropped for the Settings
  versions (per-display assign, import, the restore report); `wallpaper_current_image` stays for theme-from-wallpaper.
  The island's per-part "Show the notch" row is removed (D-024). `EnvironmentSwitches` is the last thing on the
  Recovery page, outside its gate, so it stays usable when the startup state cannot be read.

## D-029 The dock sits at the bottom only; Settings' theme list follows the dock's registry (owner, 2026-11-21 11:35)
- Settings has no dock position control and no search entry for one. `edge` stays in the dock contract
  (`dotdock-dock` protocol) and Settings passes it through unchanged; dropping the field itself is the dock tracks'
  change, since the dock and its store own it.
- Settings' `DOCK_THEMES` (`lib/native/dock.ts`) must equal `DOCK_THEMES` in the dock's `src/dock/theme.ts`. A test
  reads the dock's registry whenever that file is in the build and fails on any difference, so a theme the dock
  drops (glass may be deferred) disappears from Settings in the same merge, previews and all.

## D-030 Theme hand-over: a record retires only on a verified take-over; "Use the Windows taskbar" explained, not faked (theme track, 2026-11-21 20:15)
- **On verifies.** `take_over` reads the wallpapers back from Windows after setting them and compares the pictures
  (bytes, not paths). Only then is the record removed. When Windows keeps another picture, the record stays and the
  switch reports it, so the next off cannot record Windows' own picture as dotDock's desktop (checker issue 1).
- **Off over a left-over record.** The record is kept only while every monitor shows one of Windows' own pictures
  (the snapshot's original or the Windows-side record); otherwise the screen is dotDock's current desktop and
  replaces the stale record (checker issue 2).
- **Root cause of issue 1 not reproduced outside the app.** The same `hand_back`/`take_over` cycle run directly on
  this machine (two full cycles, IDesktopWallpaper read back each step, Progman's 0x052C sent after a set) brought
  dotDock's wallpaper back every time. What differs in the app run stays open; the verification above makes the
  failure visible and loss-free instead of silent.
- **"Use the Windows taskbar" stays disabled in this build** with copy that says why: no dock in this build can take
  the taskbar's place. It enables itself once the dock's taskbar part registers (`taskbarReplacement`). The owner's
  two switches stay the last section of Settings (Recovery page).
- The Recovery page keeps the Settings track's "Restore Windows desktop" (the panic restore with its report);
  the theme switch is the everyday way back (supersedes the "one way back" line of D-026).
## D-026 Notch live test: a real Claude Code session without touching the user's settings (notch track)
- **Context:** the live test must drive the island with a real `claude -p` session, but `~/.claude/settings.json` is off limits, so Connect cannot be used for that run, and live tests run while other windows cover the desktop.
- **Decision:** `tools/island-claude-settings.mjs` writes a settings file with exactly the entries Connect registers (a test keeps the two in step) and the session runs with `claude -p --settings <file>`, which adds the hooks for that one run. The hook then writes the session's state where a connected session writes it (`~/.claude/tools/island/sessions`, the island's own folder, read by the running app). Connect and Disconnect themselves are tested in a second run with `CLAUDE_CONFIG_DIR`, `COPILOT_HOME` and `XDG_CONFIG_HOME` pointed at scratch folders inside the worktree, each snapshotted before and compared byte for byte after. `tools/capture/backdrop.ps1` shows the Wind Meadow wallpaper in one plain window under the always-on-top island instead of changing the Windows wallpaper, so nothing on the system has to be restored.

## D-032 The standby dot breathes from a timer in eight steps (notch track)
- **Context:** the owner's idle rule is under 0.2 % CPU per process. With the island in standby, its one CSS opacity animation (a 3.2 s breath) kept the WebView2 compositor producing a frame on every refresh: 1.27 % of the machine for the app's process tree, 0.10 % with the animation paused (`tools/capture/idle-cpu.ps1`, 60 s and 40 s). A stepped CSS animation (`steps(4)`) still cost 0.46 %, because Blink services a running animation every frame.
- **Decision:** the lit standby dot is driven by `createBreather` (`apps/desktop/src/island/standby.ts`): eight light levels per breath, one timer per level, opacity written straight to the element (no React render). It holds at full light without a timer while the standby row is hidden, the page is hidden, or motion is reduced. Eight levels keep the breath readable and match the lattice's stepped look.

## D-033 The notch live harness never shares the desktop with another dotDock (notch track)
- **Context:** the app is single-instance per user. A notch test copy left running by an interrupted session blocked the dock track's real dock, and a capture tool of another track once attached to the notch app's DevTools port.
- **Decision:** a separate app identifier was not used: it would move the app's data folder, and the island's feed folder (`%LOCALAPPDATA%\dev.dotdock.desktop\agents`) and the hook paths the replays write to would no longer be the real ones. Instead `tools/capture/island-live.sh` refuses to start while another track holds `screen.lock` (under 20 minutes old) or while any `dotdock.exe` that is not this worktree's build runs, takes the lock itself, runs the app on a private DevTools port (47913), and `live_end` stops exactly the processes it started and releases the lock.
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

## D-031 The dock is bottom-only (2026-11-21, owner decision)
- The dock is the taskbar, so it sits bottom-centre and nowhere else. The position setting, its control in the
  customise panel, the fixture's edge picker, every top/left/right and vertical code path (geometry, engine, regions,
  previews, panels, CSS) and their tests are removed. `geometry.test.ts` "the dock is bottom-centred" and
  `store.test.ts` "the dock's position" guard it.
- The core's `DockSettings.edge` stays on the wire for now (the Rust struct requires it); the UI types it as
  `"bottom"` and normalises anything else on the way in, so a `dock.json` from an older build still draws at the bottom.

## D-032 The first-run dock is laid out by the core, not the UI (2026-11-21)
- The dock host already lays out an empty dock once from the machine's apps (D-027, `dock/src/starter.rs`), with a
  `laidOut` flag in `dock.json`. A second seeder in the UI, remembered in WebView local storage, would race it and
  forget itself whenever the WebView profile is reset, so the UI has none: one owner, one flag, in the core.

## D-033 Live dock runs use a debug build with the UI embedded (2026-11-21)
- A plain debug build loads the UI from `devUrl` (`localhost:1420`), and other tracks keep their own Vite servers on
  that port, so a live run could show another branch's UI. Live runs use
  `cargo build -p dotdock --features tauri/custom-protocol` after `vite build`: the exe serves `dist/` itself, as a
  release build does, and runs exactly this branch's dock.

## D-034 No native glass plate; glass is the CSS frosted plate (2026-11-21)
- Live runs showed a sheet over the whole monitor while the dock ran. Hiding windows one at a time showed it was the
  native glass plate (`DotDockGlassPlate`): DWM drew its backdrop over the plate's whole monitor-sized window
  although its window region was the pill (checked with `GetWindowRgnBox`), as flat grey (211,211,211) with the
  system backdrop (the plate is never active, so DWM draws the inactive fallback colour) and as flat light
  (242,243,244) with the accent-policy acrylic. Neither blurred the desktop.
- The plate, its `dock_set_glass` command and the UI's `nativeGlass` are removed. The Glass look is the CSS
  frosted plate the owner approved; it steps down to glass-lite when transparency is off or battery saver is on.
  The start guard (`tools/dock-tests/guard.ps1`) fails on any change of the screen outside the bar, so a sheet
  cannot come back unnoticed.

## D-035 Full screen is judged from the foreground window, not the shell's "busy" (2026-11-21)
- `SHQueryUserNotificationState` answered `QUNS_BUSY` all the time while dotDock ran, because dotDock's own dock
  and desktop windows cover the monitor. The dock took that as "a full-screen app is in front" and hid itself on
  the first change of foreground, so it vanished when the last window was minimised.
- Now full screen is the shell's screen-saver, Direct3D and presentation states, or a foreground window of
  another process (not the shell's desktop or taskbar) that covers its whole monitor and is not maximised
  (`frozen::fills_monitor`, unit-tested).

## D-036 The dock window is created before the desktop overlay (2026-11-21)
- The first WebView2 window of the process pays for starting the browser (about 2.3 s cold on this machine). The
  dock is created first so it, not the overlay, gets the head start.
## D-021 Version 1.0.0 and signed in-app updates
- **One version, everywhere.** `tauri.conf.json`, every workspace `Cargo.toml` and `apps/desktop/package.json` say 1.0.0; release.yml refuses a tag that differs, and a Rust and a vitest test assert the config agrees.
- **Updater:** `tauri-plugin-updater` (MIT OR Apache-2.0), endpoint `https://github.com/nAItiklearn/dotDock/releases/latest/download/latest.json`, minisign public key in `tauri.conf.json`. The private key lives only in `%LOCALAPPDATA%\dockDock\release\` (no password, so CI needs no prompt) and in the `TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` repository secrets. Losing it means existing installs can never verify a new update, so it must be backed up off this machine.
- **Quiet by design.** One check `STARTUP_CHECK_DELAY` (45 s) after start, no polling loop, no retry; offline costs one failed request. The check runs in the core, so the webview CSP and capabilities are unchanged. Install happens only on a click in Settings > About ("Update available"); the NSIS installer runs in passive mode.
- **The "Check automatically" switch was removed** with its `updater_set_enabled` command: the one startup check replaces the daily schedule it described, and keeping it would need a persisted setting nothing else reads.
- **CI bundles skip updater artifacts** (`createUpdaterArtifacts: false` merged on the command line) because pull requests have no signing key; only release.yml signs and writes `latest.json`.
## D-025 Photo widget: the circle shape is a pill on non-square sizes (photo track)
- **Context:** visual QA over seven wallpapers showed the circle shape as an ellipse on Wide, Landscape, Portrait, Tall and Panorama. A 4x3 or 3x4 ellipse reads as an egg, and the reference desktop (`1747058098-43375-ss7-thumb.webp`) puts a wide photo in a pill.
- **Decision:** the circle shape keeps fully round ends: a true circle on Small, Medium and Large, a pill (radius half the short side) on every other size. The dot ring is spaced evenly by distance along the pill, with an even count so it is symmetric on both axes. The option is titled "Circle or pill"; the stored value stays `circle`, so saved layouts need no migration.
- **Rejected:** keeping the ellipse (eggs on 4x3 and 3x4); centring a true circle inside wide sizes (wastes most of the footprint).

## D-034 Home screen: losing the window deselects in edit mode (home track)
- **Context:** the empty desktop is click-through (D-010), so a click on it reaches Explorer and the overlay never sees it. The selection outline stayed on a widget until another widget was pressed ("stuck selection").
- **Decision:** in edit mode the overlay holds the keyboard, so a click elsewhere takes the foreground from it. That `blur` deselects and moves focus to the overlay root (otherwise the widget takes the selection back when the window is focused again). Edit mode itself stays on; Done or Esc leaves it.
- **Rejected:** making the whole screen a hit area while editing (breaks the click-through rule after the full-screen-block incident).

## D-035 Widget colours follow the wallpaper only through theme tokens (home track)
- **Context:** the owner's V1 rule is that widget colours adapt to the current wallpaper and update cleanly when it changes. The palette from a wallpaper is built on the theme track (`aa4d6d0`, `palette.ts`, `wallpaperTheme.ts`) and saved as the custom theme `custom-from-wallpaper`; the core on this branch has no wallpaper-change event.
- **Decision:** the home screen takes every colour from the theme's CSS tokens (a test now fails on any literal colour in a home screen stylesheet) and repaints in one frame when they change (the photo caption ink is flushed in the same frame). A theme switch is instant, not cross-faded: a fade would run the stylesheet and the measured caption ink out of step. Deriving the palette again when Windows reports a new wallpaper belongs with the theme track's palette code and is logged as a blocker for the merge.
- **Rejected:** copying the theme track's palette code into this branch (two copies, merge conflicts).

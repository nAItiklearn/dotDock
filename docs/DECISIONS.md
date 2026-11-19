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

## D-019 Dock backend (`dotdock-dock`): what was decided while building it (dock milestone D1/D2)
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

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

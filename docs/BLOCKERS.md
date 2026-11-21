# Blockers

## B-001 MSVC C++ Build Tools missing (resolved by D-005)
- **Found:** 2026-11-19, P0 preflight.
- **Symptom:** `cargo build` fails at link: "you may need to install Visual Studio build tools with the C++ build tools workload". `link.exe` on PATH is Git's coreutils `link`, not MSVC.
- **Impact:** No Rust/Tauri build. All Rust work (desktop host, boot, providers) waits on this.
- **Fix (needs admin, owner asked to run):**
  `winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`
- **Meanwhile:** Safety scripts, docs, design system, wallpaper generator and the web UI layer go ahead.
- **Root cause (2026-11-19):** Windows Installer service unavailable; VS bootstrapper exits 8012 at `MsiAvailabilityCheck`.
- **Resolution:** builds move to GitHub Actions; local GNU toolchain for check/test (D-005).

## B-settings-1 The app crate's unit tests do not start under the local GNU toolchain (2026-11-21, Settings track)
- `cargo +stable-x86_64-pc-windows-gnu test -p dotdock --lib` builds, then the test exe exits `0xc0000139`
  (STATUS_ENTRYPOINT_NOT_FOUND) before any test runs: the Tauri test binary has no application manifest, so the
  loader binds comctl32 v5, which lacks `TaskDialogIndirect`.
- **Meanwhile:** every other workspace crate is tested locally (shell 126, dock 102, island 38, others); the app
  crate is covered by clippy `--all-targets` locally and by `cargo test --workspace` on MSVC in CI (`ci.yml`).

## B-theme-disk (theme track, 2026-11-21 20:23)
D: fell to 11 GB free after the last workspace test build (rule: stop cargo builds under 12 GB). Not done on this
branch because each needs a new cargo build: (1) the wallpaper-changed listener (WM_SETTINGCHANGE /
SPI_SETDESKWALLPAPER in the core, event to the theme, palette re-derived and applied, debounced, ignoring dotDock's
own writes) and its Rust test; (2) the hard live test with widgets (4 wallpaper changes, theme on/off x3, restore
script) and genuine before/applied/undone recaptures, which need a fresh `dotdock.exe` of this branch. Unblock by
freeing space (finished worktrees' `target-gnu`, ~8 GB each), then build with the existing `target-gnu`.
## B-002 Core feeds for the wind, currency and web search tiles (dock UI, 2026-11-21)
- **Need (dock host / core track):** (1) add `wind_speed_10m,wind_direction_10m,wind_gusts_10m` to the Open-Meteo
  `current` query in `shell/src/providers/weather.rs` and send them as `windKmh`, `windFromDeg`, `gustKmh`;
  (2) a `rates` feed (`{ base, publishedAt, rates }`, ECB daily XML, cached on disk); (3) `dock_open_url { url }`
  that opens http(s) only, in the default browser.
- **Meanwhile:** each tile shows its designed "Not available" state in the real app and works in the harness.
## B-home-1 Widget colours do not yet re-derive by themselves when the wallpaper changes (2026-11-21, home track)
- **What:** the owner's V1 rule needs the theme to be rebuilt from the new wallpaper whenever it changes. The palette code is on the theme track (`worktree-agent-aa4d6d019cc73921a`), which applies it only when the user presses Apply; no branch listens for a wallpaper change (`WM_SETTINGCHANGE` / `SPI_SETDESKWALLPAPER`).
- **Home side done:** every home screen colour is a theme token (guarded by `widgets/themeTokens.test.ts`); a theme change repaints the widgets in one frame (live check in `docs/QA/home-live/features.md`).
- **Owner (lead, 20:30):** reassigned to the theme track.
- **Needed at merge:** after the theme track lands, the core emits a wallpaper-changed event and the theme track's `applyWallpaperTheme` runs on it. Then rerun the wallpaper rows of `docs/QA/home-live/features.md`.

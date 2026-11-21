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

## B-home-1 Widget colours do not yet re-derive by themselves when the wallpaper changes (2026-11-21, home track)
- **What:** the owner's V1 rule needs the theme to be rebuilt from the new wallpaper whenever it changes. The palette code is on the theme track (`worktree-agent-aa4d6d019cc73921a`), which applies it only when the user presses Apply; no branch listens for a wallpaper change (`WM_SETTINGCHANGE` / `SPI_SETDESKWALLPAPER`).
- **Home side done:** every home screen colour is a theme token (guarded by `widgets/themeTokens.test.ts`); a theme change repaints the widgets in one frame (live check in `docs/QA/home-live/features.md`).
- **Owner (lead, 20:30):** reassigned to the theme track.
- **Needed at merge:** after the theme track lands, the core emits a wallpaper-changed event and the theme track's `applyWallpaperTheme` runs on it. Then rerun the wallpaper rows of `docs/QA/home-live/features.md`.

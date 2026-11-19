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

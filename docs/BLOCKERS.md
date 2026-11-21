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

## 2026-11-21 13:40 download-page track: frame-time run on battery saver
The last full scene QA run (docs/QA/website-art-live/report-all.txt) was taken with the laptop on battery at 11 %, where Windows caps the display at 30 Hz: every frame there is 33 ms, including idle pages, so it is not a measure of the scenes. The run on mains (report-perf.txt) is the evidence. Rerun `node tools/scene-qa.mjs http://127.0.0.1:4361 ../docs/QA/website-art-live perf` on mains before release.

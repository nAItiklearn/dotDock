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

## Website: owner-supplied public-figure photos (2026-11-21, updated)
The owner asked for their Drake (`b016523e…jpg`) and Travis Scott (`dc5808b0…jpg`) photos in the photo widget.
They are wired in behind one build flag, **`DOTDOCK_OWNER_PHOTOS=1`**, which is **off by default**. With the flag
off the photo widget shows the project's own halftone ridge picture and no photo file enters the build (the
`owner-photos` alias in `website/astro.config.mjs` points at an empty module). The files are kept in
`website/private-photos/` (git-ignored, never committed), so the public repository never contains them.
**Publishing needs the owner to confirm they hold the rights to both pictures.** Until then nobody builds the
public site with the flag on. Once confirmed: commit the files (or keep them local), build with the flag, and add
an "owner-supplied images, rights confirmed by the owner" line to THIRD_PARTY_NOTICES.md.

## 2026-11-21 13:40 download-page track: frame-time run on battery saver
The last full scene QA run (docs/QA/website-art-live/report-all.txt) was taken with the laptop on battery at 11 %, where Windows caps the display at 30 Hz: every frame there is 33 ms, including idle pages, so it is not a measure of the scenes. The run on mains (report-perf.txt) is the evidence. Rerun `node tools/scene-qa.mjs http://127.0.0.1:4361 ../docs/QA/website-art-live perf` on mains before release.

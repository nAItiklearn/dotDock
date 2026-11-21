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

## Website: owner-supplied public-figure photos (2026-11-21)
The lead relayed an owner decision to publish `b016523e…jpg` and `dc5808b0…jpg` (public figures) in the photo
widget. This agent's environment refused to read or convert those files (permission classifier, PII), and an
agent relay is not the owner's own confirmation. The photo widget ships borderless with the project's own
halftone ridge picture instead. To switch: the owner (or the lead) converts the two files to 1x/2x WebP in
`website/src/assets/photos/`, points `picture` in `website/src/components/Widget.astro` at them, and adds the
"owner-supplied images, used at the owner's direction; rights confirmed by the owner" line to THIRD_PARTY_NOTICES.md.

# Theme + two switches: independent checker (reviewer B), 2026-11-21

Branch `worktree-agent-aa4d6d019cc73921a`, HEAD `a07f5f4` (24 commits ahead of main). Verdict: **FAIL**.

## Checks (run by the checker in this worktree)
| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | 722 passed, 45 files |
| `vite build` | ok |
| `cargo fmt --all --check` | clean |
| `cargo clippy --workspace --all-targets -D warnings` (GNU, existing `target-gnu`) | clean |
| `cargo test --workspace` | dock 102 + 3, island 127, shell 85: 317 passed. `dotdock_lib` test binary does not start on the local GNU toolchain (`STATUS_ENTRYPOINT_NOT_FOUND`); that crate has no tests, CI (MSVC) runs it |
| D: free | 14 GB before cargo, 11-12 GB after; no further build was made |

## Live run (this build's `dotdock.exe` of 12:51, after the last Rust commit)
Logs: `checker/run.log`, `checker/run2.log`. Settings captures: `checker/30..36`. Desktop captures were not kept:
the owner's own browser was in front of the desktop.

| Step | Expected | Seen |
|---|---|---|
| dotDock wallpaper (meadow) set, theme on | meadow | meadow |
| Theme off | original wallpaper, auto-hide on, no autostart | original, auto-hide 3, no Run value or task. Pass |
| User picks `img19.jpg` while off | | img19 |
| Launch with the theme off | Settings opens | opens on Home. Pass |
| Theme on (record holds meadow) | meadow back | **original stays**; boot.log `TakenOver { wallpapers: 1 }` |
| Theme off again | original | original; the "dotDock desktop" recorded is now the **original** copy, meadow is gone |
| `tools/restore-windows.ps1` | all back | every step ok; original wallpaper, auto-hide on, app stopped. Pass |
| "Use the Windows taskbar" | | disabled (no replacement in this build), cannot be exercised |

## Bugs
1. **High: theme on does not bring dotDock's wallpaper back.** `handover::take_over` (`shell/src/handover.rs:262-280`)
   reports one wallpaper set, but Windows keeps showing the restored original (TranscodedImageCache and, on the next
   off, `IDesktopWallpaper::GetWallpaper` both say `original-wallpaper.jpeg`). The builder's own run shows the same:
   `live-run.log` 02:43:57 and `35-theme-on-screen.png` (grey original wallpaper), although `PERF_AND_REVIEW.md` says
   "dotDock's last wallpaper back". After one cycle the next off records the original as dotDock's desktop, so
   dotDock's wallpaper is lost for good. Root cause not confirmed; the unit tests use a fake desktop and cannot see
   it. Repro: theme on with a dotDock wallpaper, off, on, read the wallpaper.
2. **Medium: a stale record wins.** `hand_back` (`handover.rs:205-209`) keeps an existing record. `switch_theme`
   already ignores repeated offs, so this branch is only reached with a stale record (a failed `remove_file` at the
   end of `take_over`, a reset `modules.json`); it then drops dotDock's current desktop and the next on restores the
   stale one.
3. **Medium (owner rule): a gradient.** `src/lib/native/mock.ts:24-36` draws the sample wallpaper with
   `createLinearGradient`. "Never gradients, including test harnesses."
4. **Medium: QA evidence does not show what it claims.** Captures 20 = 22 = 23 and 26 = 27 = 28 = 31 are byte-identical
   although labelled before / applied / undone.
5. **Medium (merge order):** the page holding the two switches shows "Couldn't read this from the app · Command
   startup_get not found" (`checker/34-after-off.png`); `startup_get` exists only on the Settings IA branch.
6. **Low: copy.** "Widgets, dock, notch and wallpaper" (no dock in this build); "Off puts Windows back as it was before
   dotDock" is no longer true after D-026 (the user's later choice comes back).
7. **Unconfirmed:** in run 1, after the wallpaper was changed by `SystemParametersInfo` with the theme off, Settings
   had left the Startup page (no switches found). Not reproduced in run 2.

## Score (rubric 12.3)
| Axis | Score |
|---|---|
| Fidelity to the reference mood | 4.5 |
| Typography and dot-matrix craft | 4.6 |
| Spacing and rhythm | 4.6 |
| Colour and contrast (AA gate, 26 checks) | 4.7 |
| Motion (first switch drops frames, not measured in the app) | 4.5 |
| State completeness (theme on, startup error on the page, disabled switch) | 3.6 |
| Consistency with siblings | 4.6 |
| Originality | 4.7 |
| **Average** | **4.48** |

## Left on this machine
Wallpaper original, auto-hide on, no dotDock autostart, `modules.json` environment on (as found).
`desktop-handover.windows.json` holds a copy of the original wallpaper (harmless). The custom theme
`custom-from-wallpaper` is now the one derived from `img19.jpg` (the undo toast had expired; the previous one, a
leftover of the builder's run, had no backup). Screen lock: two runs held it 20.5 and 21.7 minutes; at 18:11 another
track's wait loop overwrote this checker's lock 8 s after it was taken, so the app ran 90 s in that slot before it
was stopped. Lock writers should use an atomic create (`set -o noclobber`).

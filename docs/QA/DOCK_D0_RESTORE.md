# D0 QA: taskbar restore guarantees

Gate (`docs/DOCK_SPEC.md` section 8): restore proven on every exit path in section 3, before any dock code may hide the taskbar.
Design: D-017. Test: `tools/test-taskbar-restore.cmd` (PowerShell: `tools/test-taskbar-restore.ps1`).

## How it was tested
- **Date:** 2026-11-19 and 2026-11-20, on the owner's machine (Windows 11 26300, one display), against the REAL taskbar.
  The owner allowed hiding the real taskbar for these tests; every run restores in a `finally`.
- **Start state:** snapshot `taskbarAutoHide = true`, taskbar visible. End state after every script run: visible, auto-hide `true`, no marker, no left-over process.
- **Probe:** the shell crate's example `dock_guard_probe` stands in for the dock. It calls the real `dock_guard::hide_for_dock` (snapshot check, sentinel start, marker, hide until stable), then ends in the way the scenario asks.
- **Variants:** `bin` = `dotdock-sentinel.exe` beside the probe; `self` = no sentinel exe, the probe hosts the sentinel itself (`--sentinel`), which is what the portable exe and dev runs do. The core exe's own `--sentinel` entry was also run by hand (`dotdock.exe --sentinel watch <pid>` exits 0 and logs; a bad argument exits 2).
- **Pass means,** within 10 s of the trigger: every taskbar window visible, auto-hide equal to its value just before the hide, marker file gone, and the sentinel of that probe has exited. Before the trigger the script asserts the taskbar really is hidden, auto-hide is on, the marker exists and exactly one sentinel watches the probe.
- **Two start states:** auto-hide as in the snapshot (`on`), and `-StartAutoHide opposite` (`off` before the hide, so the dock must switch it on and the restore must switch it back; this is the case the owner's `on` setting hides).
- **Builds:** local GNU toolchain (D-005), debug profile, plus one set with the release `dotdock-sentinel.exe` (426 KB). MSVC and the installer build run in CI only.

## Results

| Exit path | Variant | Start auto-hide | Runs | Passed | Restored after (ms): min / median / max |
|---|---|---|---|---|---|
| Hard kill (`Stop-Process -Force`) | bin | on | 3 | 3 | 25 / 29 / 36 |
| Hard kill | self | on | 3 | 3 | 23 / 25 / 31 |
| Tree kill (`taskkill /F /T`) | bin | on | 3 | 3 | 14 / 17 / 17 |
| Tree kill | self | on | 3 | 3 | 9 / 10 / 14 |
| Exit without restoring | bin | on | 3 | 3 | 20 / 113 / 124 |
| Exit without restoring | self | on | 3 | 3 | 18 / 24 / 28 |
| Panic with the taskbar hidden (hook restores) | bin | on | 3 | 3 | 4 / 4 / 5 |
| Panic | self | on | 3 | 3 | 4 / 5 / 5 |
| Clean quit (`restore_after_dock`) | bin | on | 3 | 3 | 4 / 5 / 5 |
| Clean quit | self | on | 3 | 3 | 4 / 5 / 5 |
| Sentinel killed, respawned within 5 s, then core killed | bin | on | 3 | 3 | 28 / 32 / 35 |
| Sentinel killed, respawned, then core killed | self | on | 3 | 3 | 24 / 27 / 48 |
| Sentinel and core both killed; next start's `recover_if_dirty` | bin | on | 3 | 3 | 305 / 586 / 780 |
| Sentinel and core both killed; next start | self | on | 3 | 3 | 170 / 187 / 189 |
| Second start while the owner lives: left alone, then restored by the sentinel | bin | on | 3 | 3 | 25 / 44 / 161 |
| Hard kill | bin | off | 3 | 3 | 672 / 681 / 1007 |
| Hard kill | self | off | 3 | 3 | 708 / 722 / 828 |
| Tree kill | bin | off | 3 | 3 | 745 / 795 / 837 |
| Tree kill | self | off | 3 | 3 | 645 / 688 / 727 |
| Exit without restoring | bin | off | 3 | 3 | 605 / 606 / 621 |
| Exit without restoring | self | off | 3 | 3 | 616 / 619 / 648 |
| Panic | bin | off | 3 | 3 | 18 / 20 / 21 |
| Panic | self | off | 3 | 3 | 19 / 21 / 33 |
| Clean quit | bin | off | 3 | 3 | 10 / 19 / 24 |
| Clean quit | self | off | 3 | 3 | 7 / 22 / 23 |
| Sentinel killed, respawned, then core killed | bin | off | 3 | 3 | 703 / 722 / 771 |
| Sentinel killed, respawned, then core killed | self | off | 3 | 3 | 628 / 716 / 833 |
| Sentinel and core both killed; next start | bin | off | 3 | 3 | 841 / 1193 / 1197 |
| Sentinel and core both killed; next start | self | off | 3 | 3 | 946 / 1152 / 1324 |
| Second start while the owner lives | bin | off | 3 | 3 | 672 / 689 / 730 |
| All of the above with the release sentinel exe | bin and self | on | 2 each | 30 / 30 | 4 to 1772 (median per row 4 to 180) |

**Totals:** 45 / 45 (auto-hide on), 45 / 45 (auto-hide off), 30 / 30 (release sentinel). 120 of 120 runs passed; the script reported "taskbar visible and auto-hide = snapshot value" at the end of each.

How to read the timings: with auto-hide already on, the sentinel restores in 10 to 50 ms after the kill. With auto-hide off before the hide, the restore has to switch auto-hide back, and Explorer takes about 450 ms to apply `ABM_SETSTATE`, so 600 to 800 ms. "Next start" rows include the probe process starting. The clean-quit and panic rows measure after the probe has ended, so they show the restore finished before exit.

## Findings that changed the code
1. **Explorer re-shows the hidden taskbar about 50 ms after an auto-hide change** (measured: auto-hide off to on, hide at 922 ms, visible again at 989 ms). A single `SW_HIDE` right after `set_auto_hide(true)` was undone, and the opposite-state tests failed until `hide_for_dock` hid in rounds until the taskbar stayed hidden. The dock still has to watch for Explorer restarts and call `hide_for_dock` again.
2. `ABM_GETSTATE` read straight after `ABM_SETSTATE` can still return the old value; restores verify in a 1 s settle loop before the marker is removed.
3. Probe versions that ended right after hiding made the script's "is it hidden" check race the exit; the probe now holds the taskbar hidden 3 s before the self-ending modes.

## Not tested, and why
- **MSVC build and the NSIS installer:** CI only. The build script half of the bundling was checked locally (`dotdock` debug build with the merge config in `TAURI_CONFIG` copied `dotdock-sentinel.exe` next to `dotdock.exe`); the NSIS packaging itself is first exercised by the CI `bundle` job.
- **Sign-out, shutdown, real power loss:** the CLAUDE.md rules forbid them. `recover_if_dirty` after killing both sentinel and core is the stand-in; a real reboot also rebuilds a visible taskbar by itself.
- **Explorer restarting during a restore, a job object that closes on exit, an unreadable marker:** covered by the code paths (retry for 10 s, detached start with and without breakaway, restore on unreadable) and the unit tests for the decision logic, not by a scripted test.
- **The core exe running a real dock:** nothing in the app hides the taskbar yet (D4). Shift safe mode returns before any window exists; it was not exercised with a held key.

## Unit tests (`cargo test -p dotdock-shell dock_guard`, 12 tests, all pass)
Marker round trip; atomic replace leaves no temp file; absent file; garbage, empty and directory-in-the-way files are "unreadable", never "absent"; start-up verdict (owner gone, owner running, no marker, unreadable); sentinel acts only on the pid it watched; a process restores only its own marker, and a reused pid is not an owner; the current process identity.

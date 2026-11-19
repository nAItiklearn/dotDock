# Progress

**Phase:** P0 Foundations
**Milestone:** M0

## Done
- Reference inventory and palette (`docs/design/REFERENCE_INVENTORY.md`).
- Safety net: `tools/snapshot-windows.ps1` and `tools/restore-windows.ps1`, tested on the real machine (dry-run + real run, snapshot never overwritten without `-Force`).
- Original Windows state snapshotted to `%LOCALAPPDATA%\dotDock\windows-original.json`.
- Desktop window probe (`tools/probe-desktop.ps1`): this machine (build 26300) uses the classic `Progman > SHELLDLL_DefView > SysListView32` layout. Icons are currently hidden by the user.
- Hackatime read-only check passed.
- Rust core (Tauri 2): overlay window at desktop level (S2), hidden until the UI reports it is ready, cursor-driven click-through, providers for RAM/CPU/disk/battery pushed at 1 Hz, boot stage timing in `%LOCALAPPDATA%\dotDock\boot.log`.
- Measured release cold start (local GNU build, 3 runs): window shown at 1003 / 856 / 721 ms after process start. WebView2 creation is ~600 ms of that.
- Live data verified in the release build: RAM 68 %, C: 222/236 GB, battery 32 % charging.
- CI: `.github/workflows/ci.yml` (frontend, rust fmt/clippy/test, audit, NSIS + portable bundle) and `release.yml` (tags `v*`).

## Next
- First green CI run on MSVC; review its installer.
- Autostart (Run key vs logon task, measured) + StartupDelayInMSec + crash-loop guard, all reversible by restore-windows.ps1.
- Wallpapers (generator in progress), weather provider (Open-Meteo), multi-monitor and DPI change handling.

## Machine notes that affect boot time
- 22 apps autostart from `HKCU\Run` and compete at sign-in.
- Wallpaper Engine autostarts and paints over the Windows wallpaper; the overlay must coexist.
- Display 1920×1080 at 125 % scaling.

## Known issues
- B-001 closed by D-005: MSVC builds run in CI; local builds use the GNU toolchain.

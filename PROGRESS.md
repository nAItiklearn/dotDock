# Progress

**Phase:** P0 Foundations
**Milestone:** M0

## Done
- Reference inventory and palette (`docs/design/REFERENCE_INVENTORY.md`).
- Safety net: `tools/snapshot-windows.ps1` and `tools/restore-windows.ps1`, tested on the real machine (dry-run + real run, snapshot never overwritten without `-Force`).
- Original Windows state snapshotted to `%LOCALAPPDATA%\dotDock\windows-original.json`.
- Desktop window probe (`tools/probe-desktop.ps1`): this machine (build 26300) uses the classic `Progman > SHELLDLL_DefView > SysListView32` layout. Icons are currently hidden by the user.
- Hackatime read-only check passed.

## Next
- Preflight script, CI, sub-agent definitions.
- Spike: Tauri transparent desktop-level overlay (blocked on B-001).
- Design tokens and dot-matrix components (web layer, not blocked).

## Machine notes that affect boot time
- 22 apps autostart from `HKCU\Run` and compete at sign-in.
- Wallpaper Engine autostarts and paints over the Windows wallpaper; the overlay must coexist.
- Display 1920×1080 at 125 % scaling.

## Known issues
- B-001: MSVC Build Tools missing.

# Boot test: one real restart

The only boot test that needs you. Everything else is simulated without restarting.
Takes about 3 minutes.

## Before
1. Install dotDock from the latest CI build (`dotDock_<version>_x64-setup.exe`, per-user, no admin).
2. Turn on starting with Windows: Settings → Startup & Windows, or run
   `"%LOCALAPPDATA%\dotDock\dotdock.exe" --enable-autostart`.
3. Confirm the task exists: `schtasks /Query /TN dotDock` (expect "Ready").

## Restart and watch
1. Restart Windows and sign in normally.
2. Note when the desktop appears and when the widgets appear. Do not open anything yet.

## After
Open `%LOCALAPPDATA%\dev.dotdock.desktop\boot.log`. The last block looks like:

```
<unix ms> start args=["--autostart"]
<unix ms> setup ms=…
<unix ms> window-created ms=…
<unix ms> overlay-ready ms=…
<unix ms> shown ms=…
```

## What to expect
| Measure | Expected | Investigate if |
|---|---|---|
| Wallpaper at first desktop frame | Yours, immediately (Windows draws it) | Default wallpaper flashes first |
| `shown ms` (process start → widgets visible) | 700–1000 ms on this laptop (measured warm: 721–1003) | over 3000 |
| Widgets show data | Last-known values at once, live within ~1 s | Blank or "Waiting for data" |
| Focus | Whatever you were doing keeps focus | The desktop steals focus |
| Alt+Tab | No "Desktop" entry | It appears |

A cold boot is slower than the warm numbers above: Windows is still starting 20+ other apps at
sign-in. Report the `start` timestamp relative to sign-in if it seems late; that part is
Windows's scheduling, and the logon task is already the earliest per-user launch point.

## If anything goes wrong
Double-click `restore-windows.cmd` in the install folder (or `tools\restore-windows.cmd` in the
repo), or hold **Shift** while starting dotDock for safe mode.

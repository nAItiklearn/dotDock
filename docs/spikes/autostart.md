# Spike: launch at sign-in (Run key vs logon task)

Machine: Lenovo laptop, Windows build 26300, 1920×1080 at 125 %, 22 other Run-key apps.

## Options
| | HKCU Run key | Per-user logon task |
|---|---|---|
| Admin needed | No | No (verified: a non-admin user can register an AtLogOn task for itself) |
| When it fires | After Explorer starts, then after `StartupDelayInMSec` (default ~10 s), together with every other Run entry | At logon, from Task Scheduler, independent of Explorer's startup-app delay |
| Priority | Normal | Configurable; default 7 (below normal) is too low, we set 4 |
| Contention | Starts in the same burst as the other 22 apps | Starts before the Run-key burst |
| Removal | Delete one value | `schtasks /Delete` |

## Decision
Logon task at priority 4 as the primary path, Run key as a fallback if registration fails
(D-005 context, D-011). `StartupDelayInMSec` is only zeroed on the Run-key path: with the task it
would only speed up the other apps and make them compete with us.

## Measurements
Warm process-start → widgets-visible, release build, three cold app starts (not a reboot):
1003 ms, 856 ms, 721 ms. WebView2 window creation is ~600 ms of that.

The sign-in → process-start part can only be measured with a real restart; see
`docs/QA/BOOT_MANUAL_TEST.md`. A reboot is never done unattended (CLAUDE.md).

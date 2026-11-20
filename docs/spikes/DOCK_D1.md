# Dock backend spike report (D1, with the D2 catalogue and classifier)

Crate `apps/desktop/src-tauri/dock` (`dotdock-dock`), written 2026-11-20 on the owner's laptop. Everything below
was run for real; the probes are in `dock/examples/` and can be re-run:

| Probe | What it shows |
|---|---|
| `catalogue_probe` | every launchable app, with enumeration timings |
| `classify_probe` (`-- --fixture`) | the classifier's verdict on every app |
| `icons_probe <dir>` | extraction timings and contact sheets of all icons |
| `windows_probe` | the taskbar-worthy windows right now, with timings |
| `launch_probe <dir> [app]` | click to window to close, through the service |
| `thumbnail_probe <png>` | DWM thumbnails drawn into a host window, captured to a PNG |
| `appbar_probe [-- --hide-taskbar]` | app bar reserves space, a maximised window respects it, all restored |
| `idle_probe <dir> [seconds]` | cold start, warm start, CPU and memory while idle |

**Conditions.** Windows 11 Home 10.0.26300, release profile (LTO), local GNU toolchain (D-005). The laptop was in normal
use (a terminal running this session, Brave, Chrome and Slack open; Defender and Malwarebytes are installed), so
every timing is a range over two or three runs and can move by 50 % with background load. Counts and behaviour do not.

## What works
- **Catalogue**: 214 launchable apps (63 Store, 151 desktop) from the two Start menu folders and `shell:AppsFolder`,
  de-duplicated (same AppUserModelID, same target and arguments, same name and program, or one package listing a name
  twice), with uninstallers, readmes, help, folders and web links dropped. Ids are the AppUserModelID or the normalised
  target. Publisher comes from the package manifest (Store) or the executable's version resource (desktop).
- **Classifier**: 98.1 % on this machine's apps (210 of 214 on the first judged run, all 214 after the fixes); see
  `docs/spikes/DOCK_CLASSIFIER.md`. 100 unit tests in the crate, including the golden list of this machine's apps.
- **Icons**: all 214 came back at 256 px with alpha and were checked on a contact sheet over dark and light cells
  (no fringes, no blank pages, no dots). Two problems found by looking, both fixed: shortcuts whose icon file was
  uninstalled returned the shell's blank page (Adobe Acrobat, CodeMeter), and small native icons came back as a dot in
  the middle of the canvas (7-Zip, WinRAR, Character Map, Steam game shortcuts; about ten apps).
- **Running windows**: every one of the 6 windows open during the probes was mapped to its catalogue app (Windows
  Terminal and Slack through their package folders, Chrome and Brave through their AppUserModelIDs). Changes arrive
  by push; nothing polls.
- **Launch**: by shortcut, `shell:AppsFolder\<id>` or protocol URL (`steam://rungameid/...`), measured below.
- **Thumbnails**: `DwmRegisterThumbnail` into a host window works; the screenshot shows two live copies of a colour-bar
  window, 200 x 150 each, 12 px apart, their bottom edge 12 px above the anchor and the row centred on it, and none left
  after `hide`.
- **App bar**: `ABM_NEW` / `QUERYPOS` / `SETPOS` / `REMOVE` on the top and bottom edges, 80 px deep: the work area shrinks by
  exactly 80 px, a maximised window stops at the bar, the work area is restored to the pixel after the bar is removed.
  Repeated with the native taskbar hidden (owner-approved for this test): same result; the guard then showed the taskbar
  again and left auto-hide on, as it was.
- **Frozen signal**: session lock, display power and full-screen state feed `FrozenState`; all four subscriptions were
  accepted by Windows on this machine (`shell hook`, `session notifications`, `display power`, 5 window event hooks).
- **Persistence**: settings, categories, the user's filings and the catalogue cache are written atomically and at most
  once per second; the burst, spacing and flush-on-exit behaviour is unit tested.

## Measurements
| What | Measured | Notes |
|---|---|---|
| Catalogue, cold, whole | 2.6 to 2.7 s | Start menu 1.2 to 1.3 s on 8 threads (206 shortcuts), AppsFolder 2.4 to 2.5 s (267 items; the shell's own `Next` is 1.7 to 1.8 s of it when run alone), publishers 62 to 72 ms, merge 4 to 8 ms. Sequential it was 2.8 to 3.0 s. |
| Catalogue, warm service start | first apps event 138 to 239 ms | reads the cache, checks the fingerprint (one directory walk and one registry query, no COM), starts the threads. No scan, no extraction. |
| Icon extraction, one at a time | mean 73 to 105 ms, median 65 to 92 ms, p95 147 to 206 ms, max 240 ms (one 2.7 s outlier under load) | about 58 to 115 ms in the shell and 14 to 34 ms encoding and writing the PNG |
| Icon extraction, all 214 queued at once, 4 threads | 3.1 s | what the service does on a first run |
| Icons, cache hit | 0.4 to 0.8 ms each (a `stat`) | 214 apps in 90 to 170 ms; 0 extracted on a warm start |
| Whole cold start in the service | apps after 3.3 to 5.2 s, all icons after 10.8 to 18.7 s | icons arrive in the background; the dock window waits per icon (`IconWorker::wait_for`) rather than showing broken images |
| Window list | first call 11 to 15 ms, then median 0.35 ms, max 0.9 ms for 6 windows | process paths are cached per process |
| Window push after launching an app | Calculator 1.0 to 1.3 s, Character Map 2.0 to 2.5 s after the click | dominated by the app starting |
| Window removal push after `WM_CLOSE` | 247 to 266 ms | the 250 ms minimum gap between recomputes |
| `ShellExecute` of the launch | Calculator 154 to 157 ms warm (568 ms first), Character Map 438 to 698 ms (a shortcut the shell resolves) | OS time. The dock's own part (from `service.launch` to the `ShellExecuteExW` call, inline) was 0.1 ms in the run that measured both |
| DWM thumbnail: register / show two | 0.27 ms / 0.9 to 1.0 ms | |
| Idle, 60 s, whole probe process | CPU 0.047 to 0.078 s = **0.08 to 0.13 % of one core**, working set 94 to 95 MB (peak 144 MB during the cold scan) | on a live desktop: 33 to 34 signals in 60 s (this session's terminal changing its title), 33 to 34 recomputes, 0 store writes, 0 cache writes. Budget: under 0.3 %. |

The 95 MB working set includes the catalogue, the strings of 214 apps, thread stacks, and the probe itself; the icon PNGs
are on disk (8.4 MB for 214 icons at the `Fast` PNG level).

## How the low-spec rules are met
- **No polling.** Threads: sensors (message loop in `GetMessage`), window worker, icon workers (up to 4), catalogue worker,
  two file writers, Start menu watcher, package-list watcher. Each sleeps in a blocking wait; the only timer is a one-shot
  debounce armed by an event and killed when it fires.
- **Off the UI thread.** The host's thread only calls `snapshot`, `launch` (one `ShellExecuteExW`) and the cheap command
  setters; enumeration, property lookups, icon work and file writes are on the threads above.
- **Warm start extracts nothing and scans nothing** (table above).
- **Rescans only on change**: Start menu folders (`notify`, `ReadDirectoryChangesW`) and the per-user package list
  (`RegNotifyChangeKeyValue`), coalesced after 1.5 s of quiet. No timer.
- **Writes** atomic and at most once per second.
- **Frozen**: `DockService::frozen()` and `DockEvent::Frozen` carry `{ locked, displayOff, fullscreen }`.

## Limits found
- **Tray icons**: no public API; unchanged from DOCK_SPEC 7. The dock keeps a chevron that opens the native overflow.
- **Cloaked windows**: windows on other virtual desktops (and suspended Store apps) are cloaked and are not listed, so the
  dock shows only the current desktop's windows. Showing all desktops is a setting for later.
- **Elevated and protected processes**: `OpenProcess` with limited rights fails for some, so the window has no program path.
  It is still listed (title, state, `appId` by AppUserModelID if it has one), but with no icon and no app match if it has neither.
- **Web apps of browsers** (Chrome, Brave, Edge PWAs): matched by their own AppUserModelID when the web app has a Start menu
  entry, otherwise their windows count under the browser.
- **Windows Terminal, Slack and other packaged desktop apps** announce no AppUserModelID on their windows; they are matched by
  living inside the package folder.
- **Foreground rules**: `activate` tries `SetForegroundWindow`, then attaches input to the foreground thread for the
  moment it takes; if Windows still refuses it flashes the taskbar button (the window is then not in front, and the
  result is still `{ ok: true }`). Not exercised against a UAC prompt or a locked session.
- **Shortcut resolution is slow on this machine**: `IPersistFile::Load` costs about 6 ms a shortcut (206
  shortcuts, 1.24 s in one thread; the cause was not isolated, file-open scanning by the installed antivirus is the
  likely one), which is why the Start menu scan is parallel and the result is cached.
- **Full-screen detection** uses `SHQueryUserNotificationState`, re-queried on foreground changes, restores and display
  changes. A page that goes full-screen without any of those (F11 in a browser) is noticed at the next of them.
- **DWM thumbnails and WebView2**: proven into a plain window. Whether the thumbnail is drawn above a WebView2 child
  window of the real dock host is for the integration step to confirm; `DwmRegisterThumbnail` needs a window of this
  process, so the host passes the dock window's handle to `preview`.
- **Not exercised here**: an Explorer restart (the sensors re-register the shell hook on `TaskbarCreated`; the app bar would
  need re-registering by the host), lock and unlock, display off, a full-screen game. The state logic for all of them is
  unit tested; the subscriptions are confirmed accepted.

## For the integration step
- Hold one `DockService`. `DockService::start(ServiceConfig { data_dir, icon_dir })` returns the service and the
  `Receiver<DockEvent>`; forward each event as `event.name()` and `event.payload()`.
- Commands map one to one: `snapshot()`, `launch`, `activate`, `close_window`, `set_category`, `save_categories`,
  `set_settings`, `preview(host_hwnd, scale, host_width_px, args)`. `dock_set_regions` is the host's, not the backend's.
- Serve `dock-icon://<hash>.png` with `service.icon_file(url, timeout)`; it waits for an extraction in progress and refuses
  anything that is not 16 hex digits plus `.png`.
- `DockEvent::Frozen` (`dock://frozen`) is **not in `protocol.ts` yet**; add `"dock://frozen": FrozenState` there and in
  `docs/dock/CONTRACT.md` when wiring it, and stop the dock's rendering while `frozen`.
- The app bar is not started by the service. When the user turns "reserve space" on, the host calls
  `appbar::AppBar::register` and keeps the guard; dropping it removes the bar.

## Open risks
1. Cold first run: icons for a long app list take 10 to 19 s in the background (3 s if the machine is quiet); the first
   frame needs a placeholder icon. A smarter order (pinned apps and running windows first) is not done.
2. The classifier table is hand-written; machines with many apps nobody listed will see more "Other" until their owners drag.
3. The Windows `AppsFolder` enumeration is 2.4 s and cannot be sped up from our side; it only runs on a change or a first start.
4. Thumbnails over WebView2 and the app bar under DPI and multi-monitor changes need an eye in the real host.
5. Nothing here has been run under a different Windows build, a non-English Windows, or an account without Store apps.

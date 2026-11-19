# Dock market: why people buy CoolDock, where every dock falls short, how dotDock wins

Read 2026-11-20: cooldock.app, launchmeapp.com, and the issue tracker of Seelen UI (the closest
Windows rival: a Tauri/WebView2 taskbar, dock and launcher, about 18.6k GitHub stars). Web search was
unavailable in this environment, so user opinion comes from published testimonials and real issues.

## Why people pay for CoolDock (EUR 15 to 50, one-time)
1. **Stability.** The strongest testimonial: a user tried four other dock replacements and deleted
   them "for glitches and repeated permission prompts"; CoolDock stayed because it "just works".
2. **Widgets in the dock.** "So many useful widgets": music, todos, calendar, weather, stats, quick
   toggles, Pomodoro, clipboard, plus business metrics (revenue, analytics, GitHub, Linear).
3. **Fast and attractive together** ("functional, fast and attractive... the trifecta"). Design awards.
4. **Profiles**: different docks for different contexts.
5. **No subscription, local-first**: permissions asked only when a widget needs them.
6. **Replaces the system dock** in practice ("I've replaced my default dock entirely").

## What Windows users suffer with today's options (Seelen UI's most discussed issues)
| Pain | Evidence (issue titles) |
|---|---|
| Heavy memory | "Memory: 1.29 GB → 512 MB with --process-per-site", "Frequent Out of Memory crashes", WebView2 memory growth from a widget |
| CPU spikes on idle events | "CPU jumps to ~500% after automatic display-off", "spikes when screensaver starts", "UAC prompts or sleep can cause a freeze and high CPU" |
| Lost or broken taskbar | "Dock/Taskbar not showing up", "Can't see apps on taskbar", "UI completely disappears after lock or sleep" |
| System tray | "Where is the system tray?" (31 comments), "System tray does not display anything", wrong tray icons |
| Multi-monitor | "not responding on two monitors or more" |
| Glitches covering the screen | "White/Dark/Grey square covers the screen", "unexpected tauri title bar", "wallpaper is flashing" |
| Crashes and loops | "Crashes every time I launch it", "crash-restart loop on Windows 11" |
| Disk churn | "abnormal disk write" |
| Locale fragility | breaks when region and format differ |

Classic Windows docks (RocketDock, ObjectDock, Winstep Nexus) are launcher rows that sit beside the
taskbar, look dated, and do not take over its jobs.

## The gap dotDock fills
Nobody offers, on Windows, a dock that is **(a)** the real taskbar, **(b)** beautiful in one design
language with the desktop, **(c)** organised for you (category stacks filed automatically), and
**(d)** light enough for a cheap laptop and boringly stable. Each rival has one or two of these.

## Built-in features (each must reach 4.5 on the rubric before it ships)
**Taskbar jobs:** running windows with focus and multi-window dots, live thumbnails, window menu,
pin and reorder, badges and attention flash, status pill (volume, network, battery, clock),
tray chevron to the native overflow, per-monitor docks, auto-hide, top/bottom/left/right.
**Finding things:** automatic category stacks, App Library with instant search (apps, Start-menu
files, calculator, unit conversion), recently used, keyboard-first everything.
**Live tiles, wave 1:** now playing, calendar and next meeting, focus timer, system stats, weather,
quick toggles (volume, mic mute, Wi-Fi, Bluetooth, brightness, night light, do-not-disturb).
**Wave 2:** clipboard history (respects "exclude from history"), file shelf, downloads, screenshots,
notes, to-do, colour picker, converter, world clocks, hydration reminder.
**Profiles:** Work, Home, Gaming; switch by shortcut, schedule, or when a fullscreen game starts.
Business tiles (revenue, analytics) are out of scope: they need accounts and network access.

## Performance on a low-spec laptop ("potato mode" is the default design, not an option)
Targets are measured with DevTools CPU throttling at 6x and on integrated graphics.
| Rule | Why (rival failure it avoids) |
|---|---|
| One WebView2 browser process shared by dock, overlay and island (`process-per-site`), popovers lazy-loaded and unloaded when closed | 1.29 GB memory reports |
| Zero timers while idle: everything is event-driven (shell hooks, provider pushes); the clock ticks once a minute | idle CPU |
| Freeze rendering when the display is off, the session is locked, a fullscreen app is focused, or the dock is auto-hidden | 500 % CPU after display-off, screensaver spikes |
| Transform and opacity only for every animation; no layout or paint during magnification | frame drops |
| Backdrop blur only on capable GPUs; a solid tinted surface otherwise, chosen at start and on battery saver | blur is the most expensive effect on integrated GPUs |
| Settings written at most once per second, atomically; no logs at info level in release | abnormal disk writes |
| Survive lock, sleep, display change, Explorer restart, UAC desktop switch: re-attach and re-assert, never a full-screen window | disappearing UI, grey squares |
| Locale-independent parsing everywhere (`Intl` for display only) | region/format mismatch bugs |
| Taskbar restore on every exit path, sentinel watchdog (DOCK_SPEC 3) | lost taskbar |

## Budgets added to the benchmark
Idle: under 0.3 % CPU, no wake-ups. Dock + overlay + island together: under 250 MB working set with
process sharing. Magnification and stack open: p95 frame under 16.7 ms at 6x CPU throttle (and under
8.3 ms unthrottled). Wake from display-off: no CPU spike above 5 % for more than one second.

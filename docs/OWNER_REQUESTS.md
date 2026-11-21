# Owner requests (every one must be done and verified before release)

Kept by the lead. Earlier requests are in `docs/HANDOFF.md` ("Owner feedback" and "Owner's website checklist").
A row is checked only when it is merged on main with evidence (test, screenshot or measured number).

## Release gate (2026-11-21)
- [ ] Live test of every dock feature, then every notch feature, then every home-screen feature, on screen.
- [ ] Whole-app check on the merged build: every planned feature present and working.
- [ ] Website check: every feature and detail described with photos, no overlap, all in theme.
- [ ] Every surface rated 4.8 or more. Only then deploy the website and release the app.
- [ ] No bugs from disk space or interruptions; no skipped tests.

## Owner priorities (2026-11-21 11:35)
Order: (1) the dock works absolutely fine, (2) the notch has no bugs, (3) everything placed on the home screen and
tested miserably (every feature, button, theme, customisation), (4) the website completed, (5) videos, then release.
Unfinished purely cosmetic app features are deferred and their controls removed (not the website: every website
animation must work, bug-free). Glass theme deadline 12:15; deferred and removed if not done.

## Dock (top priority)
- [ ] Fixed at the bottom only (it is the taskbar); no left/top/right positioning anywhere.
- [ ] It really works when the owner uses it by hand: clicking launches or focuses apps, right-click menus work.
- [ ] It never blocks the desktop: click-through outside its visible bar, never steals focus (incident 2026-11-21).
- [ ] So good it practically never crashes or lags (prevention over recovery): 2-hour soak with 0 crashes,
      flat memory, 60 fps under load. Recovery stays minimal: one kill-switch hotkey and the existing sentinel.
- [ ] A visible ⋯ button opens one panel to customise the whole dock (items, appearance, size, magnification,
      position, auto-hide, taskbar, reset); every control has a real, saved effect.
- [ ] Easy to add and remove apps and tiles, and to do things from the dock; well organised, all real info.
- [ ] Only apps that really work in categories and the App Library (no dead shortcuts, uninstallers, readmes,
      help links or duplicates); every removed entry listed with its reason.
- [ ] Pixel-perfect: no spacing or layout error at 100/125/150 % or in any theme; 60 fps, 0 dropped frames.
- [ ] Live test run by the agent itself on the macOS-style glass theme: add, remove, open apps, every feature,
      timed and graded, then every other theme screenshotted over the grass wallpaper.
- [ ] Live runs show the real user path (visible cursor, real clicks), captioned, not scripted state.
- [ ] Themes restyle the whole dock, not just the colour (material, translucency, blur, radius, border, shadow,
      indicators); glass is a real macOS-like frosted, transparent dock (2026-11-21 10:25).
- [ ] The dock shows its features at first glance (⋯, default tiles, stacks, App Library, full right-click menu).
- [ ] App categories come pre-made on first install from the user's real apps (2026-11-21 11:05).
- [ ] Live tests never block the owner's PC: no opaque or full-screen windows; the owner saw a white full-screen
      dock with 2 apps (2026-11-21 11:08).
- [ ] All CoolDock-gap tiles and the developer tiles, with real data.

## Notch
- [ ] Works with every agent, absolutely nicely, with many cute, calm animations per state.

## Home screen
- [ ] "+ Widgets" clickable, fast, no red or dashed grid lines, freely movable (2026-11-21 10:35).
- [ ] Move, resize, delete and add widgets directly on the home screen; tested; fast to add, smooth to move.

## Whole environment
- [ ] Smooth like Linux, no bloat: no needless polling, low idle CPU, quick start.

## Release
- [ ] Auto-update inside the app: users get new versions from the app itself, without uninstalling or downloading
      again from the website (signed updates from GitHub Releases). Later job, after the dock, notch, home screen and
      website are done (2026-11-21 13:20).
- [ ] The dock, the notch and the website each score above 4.8 on design, performance, accuracy and functionality,
      scored separately (2026-11-21 13:15).

## Website
- [ ] Features in a bento grid of cards with real screenshots, a notch carousel, zoom-on-scroll videos at the end; every page proofread and current (2026-11-21 10:45).
- [ ] Animated pixel scenes on home, Privacy and Features, never overlapping text, mobile-friendly (2026-11-21 11:00).
- [ ] Widgets section is a dense, alive grid (not dead, not half-empty); nav never covers titles.
- [ ] Pixel scenes that read instantly and match the flower theme (meadow, octopus, horse, dragonfly over lilies,
      butterflies), in place of the abstract bands, including the one before the FAQ.
- [ ] A detailed feature list with a real photo for every feature, dock first, including every dock theme.
- [ ] Photo widget showcased with the owner's Drake and Travis Scott images, borderless.
- [ ] No clipping at the page edge (the widgets grid was cut off on the left).
- [ ] A new, rich, alive download page (scenery, varied flowers, high quality).

## Dock tiles wishlist (2026-11-21, new session)
- [ ] Add most of the tile types in `docs/design/reference/owner-dock-tiles-wishlist-2026-11-21.png` (reference only,
      not shipped; build our own originals): media now-playing, unread mail, year/month/day progress dots, app folder,
      calendar event + week strip, notes, reminders/to-do, CPU/RAM/battery rings, network speed graph, wind/compass,
      digital/analogue/flip/world clocks, sunrise-sunset arc, hourly and daily weather, stocks list and chart,
      revenue/visitors/sales counters (GitHub/Vercel style dev tiles), quick toggles (Wi-Fi, Bluetooth, brightness,
      night light, keyboard), file and web search, voice recorder, emoji picker, audio output switcher, social
      follower counters, timer/stopwatch/focus timer, currency converter, contribution heat-map, issue tracker tile.
      Order: after the current dock, notch and website features pass 4.8; then one tile at a time, each tested and
      scored before the next.
- [ ] Test the dock with the macOS-style frosted glass theme (the one finished last session).

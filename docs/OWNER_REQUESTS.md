# Owner requests (every one must be done and verified before release)

Kept by the lead. Earlier requests are in `docs/HANDOFF.md` ("Owner feedback" and "Owner's website checklist").
A row is checked only when it is merged on main with evidence (test, screenshot or measured number).

## Release gate (2026-11-21)
- [ ] Live test of every dock feature, then every notch feature, then every home-screen feature, on screen.
- [ ] Whole-app check on the merged build: every planned feature present and working.
- [ ] Website check: every feature and detail described with photos, no overlap, all in theme.
- [ ] Every surface rated 4.8 or more. Only then deploy the website and release the app.
- [ ] No bugs from disk space or interruptions; no skipped tests.

## Dock (top priority)
- [ ] It really works when the owner uses it by hand: clicking launches or focuses apps, right-click menus work.
- [ ] It never blocks the desktop: click-through outside its visible bar, never steals focus (incident 2026-11-21).
- [ ] Kill switch (Ctrl+Alt+Shift+D and the tray's "Quit and restore Windows") plus the sentinel restore the taskbar.
- [ ] A visible ⋯ button opens one panel to customise the whole dock (items, appearance, size, magnification,
      position, auto-hide, taskbar, reset); every control has a real, saved effect.
- [ ] Easy to add and remove apps and tiles, and to do things from the dock; well organised, all real info.
- [ ] Only apps that really work in categories and the App Library (no dead shortcuts, uninstallers, readmes,
      help links or duplicates); every removed entry listed with its reason.
- [ ] Pixel-perfect: no spacing or layout error at 100/125/150 % or in any theme; 60 fps, 0 dropped frames.
- [ ] Live test run by the agent itself on the macOS-style glass theme: add, remove, open apps, every feature,
      timed and graded, then every other theme screenshotted over the grass wallpaper.
- [ ] Live runs show the real user path (visible cursor, real clicks), captioned, not scripted state.
- [ ] All CoolDock-gap tiles and the developer tiles, with real data.

## Notch
- [ ] Works with every agent, absolutely nicely, with many cute, calm animations per state.

## Home screen
- [ ] Move, resize, delete and add widgets directly on the home screen; tested; fast to add, smooth to move.

## Whole environment
- [ ] Smooth like Linux, no bloat: no needless polling, low idle CPU, quick start.

## Website
- [ ] Widgets section is a dense, alive grid (not dead, not half-empty); nav never covers titles.
- [ ] Pixel scenes that read instantly and match the flower theme (meadow, octopus, horse, dragonfly over lilies,
      butterflies), in place of the abstract bands, including the one before the FAQ.
- [ ] A detailed feature list with a real photo for every feature, dock first, including every dock theme.
- [ ] Photo widget showcased with the owner's Drake and Travis Scott images, borderless.
- [ ] No clipping at the page edge (the widgets grid was cut off on the left).
- [ ] A new, rich, alive download page (scenery, varied flowers, high quality).

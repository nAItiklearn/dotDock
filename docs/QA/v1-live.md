# V1 live test, 2026-11-21 to 2026-11-22

Release build (`cargo build -p dotdock --release`, GNU toolchain) on the owner's laptop, 1920 x 1080 at 125 %, the
owner's own wallpaper. Screenshots in `D:\dotDock\docs\QA\v1-live\` (not committed: they show the owner's desktop).
Input is real: the cursor and the buttons are driven through `SetCursorPos` / `mouse_event`, keys through `SendKeys`,
and every check reads the real state (the window under the cursor, the foreground window, the registry, the core's
own answers). A check that touches the screen first confirms nobody else is using the PC (`GetLastInputInfo`).

## Bugs found and fixed during the run

| # | What the owner saw | Cause | Fix |
|---|---|---|---|
| 1 | Nothing on the dock, widgets or notch could be clicked | Layered windows without `SetLayeredWindowAttributes` are hit-tested against a stale bitmap | Full opacity set on every host window (`d647791`) |
| 2 | Top of the dock cut off, glass plate invisible | The CSS minifier rewrote `light-dark()` for an old browser target | `cssTarget: chrome123`, test (`d647791`) |
| 3 | Panels see-through, text hard to read | Translucent fills over a blur that has nothing behind it (D-034) | Opaque panels, denser glass (`ab0c5aa`, `c50a194`) |
| 4 | Spotify twice on the dock | Store app windows not matched when the catalogue lacks the versioned package folder | Match by package family, test (`ab0c5aa`) |
| 5 | Windows taskbar popped up over the dock after theme on | Explorer re-shows it after some broadcasts | 1 s watchdog re-hides it while the dock stands in (`ab0c5aa`) |
| 6 | Window previews covered the preview card's title | The core laid out its own row of thumbnails | Thumbnails fill the card's slots, tests (`deeb188`) |
| 7 | File Explorer's icon could not focus or minimise its windows | Explorer windows carry no AppUserModelID | Matched by `explorer.exe`, test (`362c4ae`) |
| 8 | Owner request: dock hides like macOS | | Auto-hide on by default; reserves nothing (`362c4ae`) |
| 9 | Dock flickered with the cursor on the screen edge | The shown dock's click area stopped above the edge | Edge strip stays in the area, test (`362c4ae`) |
| 10 | Dock vanished under a full-size File Explorer | A titled window filling the screen counted as full screen | Full screen also needs no title bar, tests (`3589113`) |
| 11 | System popover spilled onto the dock; giant text fields; cut tab rows | Fixed sizes and `flex: 1` in columns | Sizes fixed, fields capped, tabs wrap; every popover measured (`c50a194`) |
| 12 | Tiles that can never show data (currency, wind, weather, contacts) | No feed or no setup screen | Held from the V1 gallery, D-043 (`c50a194`, `4ede58e`) |
| 13 | Opening Settings from the home screen froze the whole app | `settings_open` built a window from a synchronous (main-thread) command | Async command (`f76f3fa`) |
| 14 | Typing in Web search went nowhere | Focus returned to the pressed tile | `useFocusField`, tests (`f76f3fa`, `7e7c3f6`) |
| 15 | Ctrl+Z / Ctrl+Y / Ctrl+D ignored from some keyboards | Matched on `e.code` only | Also the typed letter when there is no code, test (`f76f3fa`) |
| 16 | Picking a wallpaper in Settings did not recolour | dotDock's own wallpaper writes are not followed | The library pick announces itself (`da1bc85`) |
| 18 | A tile added to the dock never updated (stopwatch stuck at 00:00) | Watch and unwatch ran in parallel on the core's thread pool | Run in order, test (`b1ec6fb`) |
| 19 | Wide tiles clipped ("00… ST…") | Length ratios too short for their words | Ratios measured live and raised (`b1ec6fb`, `81d1a74`) |
| 17 | Colours ran one wallpaper behind | Windows reports the new wallpaper a moment late | The core keeps and serves the announced file (`52a5576`) |

## Verified live on the final code

- Hit-testing: dock items and widgets take clicks, empty desktop passes them through; the island takes clicks only
  while a session shows.
- Dock: Chrome, Spotify and File Explorer open, focus, minimise and restore from their icons (3 to 5 rounds each,
  plus 6 rapid clicks); stacks open and launch (Git CMD, Paint); App Library search + Enter launches Calculator; windows
  close from the dock; right-click menu, Move to stack and back, Keep in dock, drag to reorder and back, remove and
  re-pin; icon size, magnification, auto-hide, all six looks; live window previews; the music tile drives Spotify.
- All 22 tile popovers open with nothing overflowing or clipped (`popovers/*.png`); Web search opens the default
  browser on the query.
- Home screen: every one of the 9 widget types added from the drawer, placed with no overlaps and none off screen;
  moved, rearranged (others reflow), resized, removed with the × and with Delete, undo and redo by toolbar and by
  Ctrl+Z / Ctrl+Y; edit mode by Ctrl+Alt+E; the music widget's play, pause and next drive Spotify. The owner's
  layout was saved first and restored exactly afterwards.
- Wallpaper follow: changes from Windows and picks in Settings recolour the widgets and the dock within a second
  (green, gold, violet, red, the owner's purple), and Original brings the owner's own picture back.
- Theme off then on, three times: off shows the Windows taskbar with auto-hide on and the owner's wallpaper; on
  hides the taskbar again. The wallpaper file exists after every step.
- Settings: all 18 pages lay out cleanly (`settings/*.png`); icon size and notch size follow their sliders live;
  Obsidian and My wallpaper themes switch every window; profiles Focus and Work switch and come back intact; Launch
  at sign-in creates and removes the real logon task; Settings opens from the home screen and closes normally.
- Notch: every state of a replayed session (thinking to stopped) draws; it slides aside under the cursor and comes
  back; right-click dismisses a session.
- Safety: the quit shortcut (Ctrl+Alt+Shift+D) restores the taskbar with auto-hide, verified; a killed process is
  cleaned up by the sentinel, verified.

## Final regression (build `81d1a74`)

19 of 19 automated live checks pass (`final-regression.txt`); 15 random widget moves and resizes with no overlap and
nothing off screen; undo x5 and redo x2; the layout survives a reload; 8 wallpaper picks in a row from Settings each
recolour the widgets and the dock together, and Original brings the owner's picture back.

## Gate on the final code

`tsc --noEmit` clean; vitest 1925 tests (1 skipped, explained in the suite); `cargo fmt --check`, `cargo clippy
--workspace --all-targets -D warnings` clean; `cargo test --workspace` 655 passed; website `pnpm build` (0 errors,
0 warnings) and 59 tests.

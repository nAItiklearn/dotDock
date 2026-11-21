# Dock UI: evidence for each row of `docs/dock/FEATURE_PARITY.md` (2026-11-21)

Scope of this track: the dock's TypeScript UI and its browser harness (`apps/desktop/dock.html` under `vite dev`,
fixture backend, DEV panel hidden behind the backquote key). A row is **UI accepted** when its behaviour has unit or
render tests that pass and a screenshot of it on the dock over the Wind Meadow wallpaper. Rows whose acceptance needs
the real machine (Windows calendar, Core Audio, the taskbar) are marked **needs host**: the UI side is done and
tested against the contract, the live test belongs to the dock host track (`docs/QA/dock-live/`).

Test files are under `apps/desktop/src/dock/`. Screenshots are in `docs/QA/dock-ui-live/`.
Full suite at this commit: 80 files, 1 220+ tests, all green; `tsc --noEmit` clean.

## Dock items
| Row | UI evidence (tests) | Screenshot | Status |
|---|---|---|---|
| Pinned apps: pin, reorder by drag, unpin | `model.test.ts` "pinning", "reorderBy"; `reorder.test.ts` (drop index, slide offsets, drop on stack edge vs middle); `menu.test.ts` "Keep in dock" / "Unpin" | 01, 10 | UI accepted; survives restart = core `dock.json` (needs host) |
| Category stacks + user stacks | `model.test.ts` stack preview and counts; `store.test.ts` "showStack"; `reorder.test.ts` "files an app dropped on the middle of a stack"; `menu.test.ts` "Move to stack" | 09 | UI accepted; filing new installs = core classifier (needs host) |
| Folder items, link items, action items | not built in the UI yet | none | open (D7 scope) |
| Profiles | not built | none | open (D7 scope) |
| Dock themes: glass, glass-lite, obsidian, paper, aurum, minimal | `theme.test.ts` (resolveTheme steps glass down to glass-lite when effects are lite, blur unavailable or battery saver; palette per theme; saved choice); `effects.test.ts` | 12-17 | UI accepted; real native acrylic blur = host |
| Floating layouts, any edge | `geometry.test.ts` (metrics, placeBesideDock per edge), `regions.test.ts` | 11 | UI accepted; work area / monitors = host |
| Running windows: dots, focus accent, thumbnails, window menu | `model.test.ts` "indicatorFor", "groupWindows", "activationTarget"; `hoverIntent.test.ts`; `geometry.test.ts` "previewLayout"; `menu.test.ts` window entries | 01 (dots), 10 | UI accepted; live DWM thumbnails = host |
| Replaces the taskbar | n/a in the UI | n/a | host track only |
| Context menu | `menu.test.ts` (bar, pinned running app, unpinned app, stacks, tiles, windows, gallery and settings entries, row sizes for keyboard) | 02 | UI accepted |
| Edit mode | `model.test.ts` "adds the add tile in edit mode"; `render.test.tsx` "tiles in edit mode" | 10 | UI accepted |
| Settings popover | `render.test.tsx` "the dock settings popover" | 11 | UI accepted |
| Magnification | `magnify.test.ts` (falloff, scaleFor, computeMagnify, maxGrowth); perf in `PERF.md` | 01 | UI accepted |
| Badges (new installs) | `model.test.ts` "freshAppIds" | 09 | UI accepted |
| Keyboard navigation and accessibility | `nav.test.ts` (grid moves, sections, type to filter); `menu.test.ts` keyboard rows; every tile has a group label and a hit button (`render.test.tsx` "every tile on the dock"); DEV key `dev/panelKey.test.ts` | 18 | UI accepted |
| In-dock widget gallery | `galleryItems.test.ts`, `render.test.tsx` "the widget gallery" | 03, 04 | UI accepted |
| App Library | `librarySections.test.ts`, `nav.test.ts` matching | 19 | UI accepted |

## Live tiles
| Row | UI evidence (tests) | Screenshot | Status |
|---|---|---|---|
| Now playing | `render.test.tsx` "every tile on the dock" (media) | 01 | needs host (media session) |
| Calendar, next event, meeting join | `render.test.tsx` "agenda", "meeting"; `devTiles.test.ts` "what the day holds"; `agenda.test.ts` | 20 | needs host (calendar account) |
| To-do | `render.test.tsx` "reminders"; `reminders.test.ts` | 20 | UI accepted (shared store) |
| Pomodoro, sessions n of 4 | `render.test.tsx` "focus"; `focus.test.ts` | 20 | UI accepted |
| Hydration with wave | `render.test.tsx` "hydration"; `wave.test.ts`; `devTiles.test.ts` "hydration" | 20 | UI accepted; reminder notice = host |
| Clock, analog, flip, world clocks | `render.test.tsx` "processor, battery and the analog clock", "world clock"; `more.test.tsx` "flip clock"; `tools.test.ts` "world clock" | 05 | UI accepted |
| Notes | `render.test.tsx` "notes" | 20 | UI accepted |
| System stats, CPU graph, battery | `render.test.tsx` "system", "processor, battery…"; `history.test.ts` | 20 | needs host (values vs Task Manager) |
| Network graph | `render.test.tsx` "network"; `tools.test.ts` "network" | 20 | UI accepted on fixture; live = host |
| Quick toggles | `render.test.tsx` "quick settings"; `devTiles.test.ts` "quick settings" | 20 | needs host (real switches) |
| Audio devices, volume | `render.test.tsx` "sound"; `devTiles.test.ts` "audio" | 20 | needs host (Core Audio) |
| Mic level | `render.test.tsx` "microphone"; `devTiles.test.ts` "microphone" | 20 | needs host |
| Stopwatch | `render.test.tsx` "stopwatch"; `devTiles.test.ts` "stopwatch" | 20 | UI accepted |
| Progress as a dot grid (day, month, year) | `render.test.tsx` "progress"; `period.test.ts` | 20 | UI accepted |
| Contacts | `render.test.tsx` "contacts"; `contacts.test.ts` | 20 | needs host (deep links) |
| Converter (units) | `render.test.tsx` "converter"; `tools.test.ts` "units" | 03 | UI accepted |
| Currency converter | `currency.test.ts`; `more.test.tsx` "currency" | 07 | UI accepted on fixture; rates feed = host (B-002) |
| Emoji | `render.test.tsx` "emoji"; `tools.test.ts` "emoji" | 03 | UI accepted (copy); insert into Notepad = host |
| Colour picker | `render.test.tsx` "colour picker"; `tools.test.ts` "colours" | 03 | UI accepted |
| Sun arc | `sun.test.ts` (London solstice and Mumbai within 3 min, polar night, midnight sun, old zone names); `more.test.tsx` "sun arc" | 06 | UI accepted |
| Wind | `wind.test.ts`; `more.test.tsx` "wind" | 05 | UI accepted on fixture; wind fields = host (B-002) |
| Web search | `search.test.ts` (engines, addresses, only http(s) leaves); `more.test.tsx` "web search" | 05 | UI accepted on fixture; `dock_open_url` = host (B-002) |
| History | `recent.test.ts`; `more.test.tsx` "history"; launches recorded in `bridge.ts` | 05 | UI accepted |
| Voice memo with waveform | `memo.test.ts`, `memoRecorder.test.ts` (support check, refusal is "no device"); `more.test.tsx` "voice memo" | 08 | UI accepted; recording a real memo needs a microphone permission prompt the owner answers |
| Clipboard, screenshots, file shelf, downloads, photos | not dock UI tiles yet | none | open (native tiles track) |
| Search (files, calculator, units) in the App Library | `librarySections.test.ts`, `nav.test.ts` | 19 | UI accepted for apps (name, initials, publisher, category); calculator and units live in the Converter tile; files = host |

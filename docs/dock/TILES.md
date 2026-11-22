# Live tiles: what each one reads, when it runs, what was measured

Crate `apps/desktop/src-tauri/tiles/` (`dotdock-tiles`): native data providers with no UI framework, so everything
here is unit-testable. Decisions are in `docs/DECISIONS.md` D-024. The UI side is the dock UI branch's
`tiles/ui-types.ts` and `tiles/backend.ts`.

## Two doors
- **`DockTiles`** (`dock.rs`, shapes in `wire.rs`) serves the tiles the dock UI shows first. The host forwards its
  events to the dock window and maps six commands onto its methods.

  | Wire name | Rust |
  |---|---|
  | `dock_tiles_watch { feeds }`, `dock_tiles_unwatch` | `DockTiles::watch(&[FeedName])`, `unwatch()` |
  | event `dock://tiles` (`Partial<TileFeeds>`) | `DockEvent::Feeds` (`EVENT_FEEDS`) |
  | `dock_mic_watch`, `dock_mic_unwatch`, event `dock://mic-level` (0 to 1) | `mic_watch()`, `mic_unwatch()`, `DockEvent::MicLevel` (`EVENT_MIC_LEVEL`) |
  | `dock_contact { id, action }` | `contact(&id, action)` |
  | `dock_join_meeting { url }` | `join_meeting(&url)` |
  | `dock_stopwatch { op }` | `stopwatch(StopwatchOp)` |
  | `dock_toggle_mic` | `toggle_mic()` |
  | `dock_hydration { op }` | `hydration(HydrationOp)` |
  | `dock_audio { op }` | `audio(AudioOp)` |

  A new `watch` replaces the previous one, delivers the current value of each named feed at once, then each change.
  Calls block (they start threads and talk to Windows): the host makes them from a worker thread. They are
  serialised, so two watches from different threads cannot leave a provider running that nobody watches.
- **`TileHub`** (`hub.rs`, types in `protocol.rs`, mirrored by `apps/desktop/src/dock/tilesProtocol.ts` and checked
  by two tests that fail when the command names or tile ids drift) serves the second-wave tiles that have no UI yet:
  clipboard, screenshots, downloads, shelf, toggles, system history, voice memo, colour picker.

## Feeds of the dock UI
| Feed | Reads | Runs | Issue when empty |
|---|---|---|---|
| `audio` | Core Audio: default output's endpoint volume and mute, the device list, default-device changes, app sessions; `IPolicyConfig` for the switch | one thread, asleep until Windows calls a callback; a volume callback re-reads two numbers, anything else the whole state | `no-device` |
| `mic` | the default capture endpoint's mute | same | `no-device` |
| mic level (`dock://mic-level`) | a shared-mode capture stream's peak meter, 30 Hz | only while watched **and** unmuted: the stream is closed while muted, so Windows' microphone indicator is on only when it is really listening | none; a microphone Windows refuses to open reads as level 0 (the reason is in `MicrophoneLevel.problem` on the generic door) |
| `meeting` | the first timed event that has not ended, from the calendar | with `agenda` | `needs-setup` (Windows has no account and no events), `error`; no upcoming event is `{ data: null, issue: null }` |
| `agenda` | today, local midnight to midnight, from the calendar | with `meeting` | as above |
| `contacts` | `contacts.json`, typed in by the user; one way per action (call, video, message) through the first of their apps that can | nothing runs | none (an empty list is a state) |
| `stopwatch` | `stopwatch.json`; a Unix start time, so it counts across a restart | nothing runs; the UI draws the digits from `startedAt` and `bankedMs` | none |
| `hydration` | `hydration.json`: today's glasses, the last glass, a snooze | one thread that wakes only at local midnight (or hourly, in case the clock changed) to start the new day | `error` if Windows will not give the local time |

Calendar sources, in order: an `.ics` file the user chose (own parser: weekly, monthly and yearly rules with
`COUNT`, `UNTIL`, `EXDATE`, edited occurrences, `VTIMEZONE` rules; meeting links found in the location, URL and
description), else Windows' own appointment store (`Windows.ApplicationModel.Appointments`, which opens without
package identity). Nothing is fetched from the network. The calendar worker wakes when the file changes, at midnight,
when an event starts or ends, and at least every five minutes to see edits made in Windows.

Meeting links are recognised for Teams, Zoom, Meet and Webex. `join_meeting` opens a link only if it is itself a
recognised meeting link, never an arbitrary URL. Contact links are checked against `shell`'s scheme allow list.

Water reminders: 8:00 to 22:00, one hour after the last glass, never once the goal (2000 ml) is reached, not before a
snooze has run out; after the window or when the next one would fall after it, tomorrow at 8:00. The core only says
when; showing the notice is the UI's job. A reminder time in the past means "due now".

## Second-wave tiles (`TileHub`)
| Tile | Reads | Runs |
|---|---|---|
| clipboard | the clipboard format listener; entries marked "exclude from history" or "can include in history = 0" (password managers) are never stored; optional history kept encrypted with DPAPI, off by default | one thread, asleep until the clipboard changes |
| screenshots, downloads | the newest files of Pictures\Screenshots and Downloads, `notify` watcher; unfinished downloads (`.crdownload`, `.part`) are flagged | one watcher per folder |
| shelf | `shelf.json`: paths the user dropped; a file deleted later is flagged, not dropped | nothing runs |
| toggles | radios (Wi-Fi, Bluetooth) through `Windows.Devices.Radios`, brightness through the power plan and a WMI worker, night light and Do Not Disturb through registry change notifications | one thread, asleep on kernel events |
| system history | CPU, memory, disk and network, once a second | one thread, only while watched |
| voice memo | records the default microphone to a WAV in Documents\dotDock Voice Memos, plays it with `PlaySound` | a thread only while recording |
| colour picker | low-level mouse and keyboard hooks and a 33 ms sampler | only while picking, ends on click, Escape or after the timeout |

## Where files go
Everything the tiles keep (`contacts.json`, `shelf.json`, `stopwatch.json`, `hydration.json`, `tiles-settings.json`,
`colour-history.json`, the optional encrypted clipboard history) is in the data folder the host passes in
(`%APPDATA%\dockDock`). Two things are written to the user's own library, and only when the user presses the button:
a screenshot (Pictures\Screenshots) and a voice memo (Documents\dotDock Voice Memos), because that is where a person
looks for them. File commands (open, reveal, thumbnail) refuse anything outside Downloads, Screenshots, the voice
memo folder and the shelf. Nothing touches `HKLM`; the registry is read, never written.

## Tests
`cargo test -p dotdock-tiles` (local GNU toolchain, see `docs/DECISIONS.md` D-005): 167 tests, run on this laptop's
real Windows APIs where they can be (Core Audio, the appointment store, the clipboard vault, a real screen grab);
the brightness worker is tested against a fake panel, because a test must not change the real screen. Two more play a short system sound through the speakers and listen to its loopback, so
they run on request: `cargo test -p dotdock-tiles -- --ignored`. The output must not be muted (Windows hands a loopback
silence then, and a test must not change the user's settings), and the recording test tries up to three times because
this laptop's loopback stays silent now and then (about one try in six). Clippy with `-D warnings` is clean.

`cargo run -p dotdock-tiles --release --example tiles_probe -- <scenario>` is the real-hardware probe the numbers
below came from. Scenarios that change a system setting put it back before they end; `dock` keeps everything in a
temporary data folder.

## Measured on this laptop (2026-11-20, release build, Windows 11 build 26300)
The machine was busy compiling for other tracks while these ran (about 85 % CPU in use), so the load figures are
upper bounds.
- **Idle cost** (20 s windows after a 10 s settle): nothing watched, 0.000 s of CPU; audio, microphone, calendar,
  clipboard, screenshots, downloads and toggles all watched, 0.094 s = 0.47 % of one core; system history alone
  (one sample a second), 0.19 s = 0.94 % of one core; mic level with the microphone muted, 0.000 s. After
  unsubscribing everything no tile is active.
- **Input to visible** (command to the event the UI receives): the stopwatch and the water log 4 to 8 ms (6 to 11 ms in
  the second run); audio volume 22 to 45 ms once warm (160 to 180 ms for the first change after start), mute 52 ms;
  watching all seven feeds delivers the last of its four updates after 0.8 s, dominated by opening the Windows
  appointment store.
- **Calendar**: choosing an `.ics` file shows its events after 419 ms; saving the file updates the tile after 411 ms,
  of which 400 ms is the wait for the editor's several writes to settle. This laptop has no calendar account, so the
  Windows source reports `needs-setup`, which is the designed empty state.
- **Colour picker**: the pixel under the cursor was read 76 ms after starting and matched an independent screen grab.
- **System history**: the CPU line rose to 100 % under a full-core load; idle readings were inflated by the other
  builds.
- **Not run here**: the microphone scenario (it mutes and unmutes the real microphone), the toggles scenario
  (Wi-Fi, Bluetooth and brightness change the real machine), and the screenshot, downloads and voice memo scenarios
  (they write into the user's Pictures, Downloads and Documents folders). Their logic is covered by unit tests; run
  them by hand before release.

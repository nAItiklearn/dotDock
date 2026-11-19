# MASTER_SPEC: dockDock (working codename)

> A free, open-source, Nothing-OS-inspired desktop environment for Windows.
> Home screen first. Dock second. Agent Island (notch) last. Website after v1.
> Owner is asleep. Work autonomously, produce proof, never ask questions.

Project root: `D:\dockDock` (git already initialised). Read `CLAUDE.md` and `PROGRESS.md` at the start of every session.

---

## 0. Mission and quality bar

Build the most polished, fast, glitch-free Nothing-style desktop environment for Windows that exists, and make it free. The quality bar is "a team shipped this over months":

- It looks like the reference screenshots in the project folder, and better where we can.
- Every feature works, every time. No glitches, no lag, no half-features.
- Customisation is a first-class feature. Almost everything is a setting, a token, or a plugin point.
- The owner explicitly does **not** care about RAM. Smoothness, correctness and beauty beat memory savings. Only fix memory if it exceeds the alarm thresholds in section 13.
- "No AI slop" is a hard rule (defined in section 12.4).

Phase order (do not skip ahead, do not start a phase before its gate passes):

| Phase | Name | Gate to start next |
|---|---|---|
| P0 | Foundations, safety net, spikes | Spike decisions logged, restore script tested |
| P1 | **Home Screen Release** (wallpaper, widgets, settings, customisation, boot flow) | Section 14 checklist all green |
| P2 | Dock (mac-style taskbar replacement with built-in CoolDock-style features) | Own spec section 15 gate |
| P3 | Agent Island (notch-style status pill, port of agent-island idea) | Section 16 gate |
| PW | Showcase website (awwwards-grade) | Separate brief, after v1. Out of scope here |

Not in v1: live wallpaper, Google Calendar auth, Start menu / notification-center / tray replacement. Design the architecture so these can be added without rewrites.

---

## 1. Autonomy contract (the owner is asleep)

1. **Never ask the owner a question.** If something is ambiguous, pick the best option, write it in `docs/DECISIONS.md` (decision, alternatives, why, how to reverse it), and continue.
2. **If blocked** (missing tool, elevation prompt, network failure), log it in `docs/BLOCKERS.md`, then continue with other unblocked work. Never sit idle on one blocker.
3. **Stop only** if the next step would be irreversible and outside the scope in section 1.1. Otherwise keep going.
4. Keep a running `PROGRESS.md` (current phase, current milestone, what is done, what is next, known issues). Update it after every feature and before any long operation, so a context reset loses nothing.
5. After each milestone write `docs/reports/<milestone>.md`: what was built, screenshots, perf numbers, review findings, open issues. The owner reads these in the morning in two minutes.
6. Commit small and often (Conventional Commits). Tag each milestone `m<n>-<name>`. Never force-push. No remote push required.

### 1.1 Scope of machine changes (safety rails)

Full tool permissions are granted so you are never blocked on prompts, but stay inside this scope:

- Read/write freely inside `D:\dockDock`.
- App data in `%APPDATA%\dockDock\` and `%LOCALAPPDATA%\dockDock\` (app name comes from one `APP_NAME` constant).
- Registry only under `HKCU`: autostart `Run` key, `...\Explorer\Serialize` (`StartupDelayInMSec`), and the app's own key. Always snapshot the original value first.
- Windows wallpaper settings (snapshot originals first), desktop icon visibility, taskbar visibility (P2 only).
- Do **not**: touch `HKLM`, system files, other users, other drives or folders, Windows Update, Defender settings, or the live `~/.claude/settings.json` (tests use a temp config dir; the real Connect flow in P3 is only exercised against a temp copy).
- Do **not** reboot, sign out, or shut down the machine. Test boot behaviour with process-level simulations (section 7.5). A real reboot test is on the owner's morning checklist.
- No telemetry, no analytics, no phoning home. The only network calls are the ones listed in section 9.4.

### 1.2 Panic button (build this first, in P0, before any shell-altering code)

`tools/restore-windows.ps1` (and a matching in-app "Restore Windows desktop" action) that:

- restores the original wallpaper and fit mode per monitor from the snapshot,
- re-shows desktop icons and (P2) the native taskbar,
- removes our autostart entries and restores the original `StartupDelayInMSec` state,
- terminates our processes.

Also build a **crash-loop guard**: if the app crashes 3 times within 5 minutes of launch, it disables autostart, runs the restore routine, and shows a notice on next manual launch. Holding **Shift** during sign-in/app launch starts in safe mode (no shell changes, settings window only).

Test the restore script on the real machine before building anything else that changes shell state.

### 1.3 Time tracking (Hackatime / WakaTime)

The owner uses a Hackatime (WakaTime-compatible) extension for hour tracking. It auto-detects, so do not fiddle with it.

- At P0 do a read-only check: does `%USERPROFILE%\.wakatime.cfg` exist with an `api_url` and an `api_key` set, and does `%USERPROFILE%\.wakatime\` exist. Never print or log the key.
- Write the result to `docs/HACKATIME_STATUS.md` (pass/fail, what was checked). Never block on it.
- Heartbeats come from the editor. If work is done headless from a terminal, tracking may record nothing. Note that honestly in the status file.
- **Never fabricate, script, or replay synthetic heartbeats.** Time tracking must reflect real activity only.

---

## 2. Product principles

1. **The desktop is the product.** The wallpaper and widgets should look like the Nothing phone home screen moved to a PC.
2. **Zero-friction boot.** Granting permission once makes it the default forever. No manual launching, ever (section 7).
3. **Reversible.** One toggle in settings returns the user to stock Windows, cleanly, with their original wallpaper and icons.
4. **Everything is data.** Themes, widgets, layouts, icon packs and wallpapers are files users can edit, import and share.
5. **Polish over breadth.** A smaller feature set that feels perfect beats a larger one that feels almost right.
6. **Fast.** Interactions hit the display refresh rate. Nothing blocks the UI thread.
7. **Private.** Local-first. No accounts. No tracking.
8. **Clearly original.** Inspired by Nothing, never copying Nothing's proprietary assets (section 17).

Branding: all user-visible names come from one `branding.ts` / `branding.rs` constant. The final product name is undecided. Do not hard-code "dockDock" in UI strings, installer metadata, or window titles. Never use "Nothing", "Ndot" or "Nothing OS" in the product name or UI. "Inspired by Nothing OS" is allowed in docs only, with a "not affiliated" disclaimer.

---

## 3. Reference material (read before designing anything)

### 3.1 Inventory

Recursively scan `D:\dockDock` for every image (`.webp .png .jpg .jpeg .gif .svg`), including the root folder (the owner placed Nothing phone-widget images in the root). Write `docs/design/REFERENCE_INVENTORY.md` listing each file, what it shows, and what you extract from it. Do not move or rename the originals. Copy working derivatives into `design/reference/`.

If screenshots and this document disagree on **visuals**, the screenshots win. If they disagree on **behaviour**, this document wins.

### 3.2 Visual language already observed in the owner's reference screenshots

Use this as a starting point. Verify and extend it from the real files.

- **Three theme moods:** light grey/white with a single red accent; dark mono with silver/grey; dark with gold/yellow accent.
- **Shapes:** pills and perfect circles, very large corner radii, rounded device-frame feel. Soft shadow on light theme, subtle inner border on dark.
- **Typography:** large dot-matrix display type for the clock and date (bold split digits, striped-line digits, filled-circle digits). Small monospace caps labels ("RAM", "SUNDAY", "FUN FACTS").
- **Data viz:** dot-grid gauges (filled accent dots vs dim dots) for RAM and battery, half-circle gauge pairs, circular date widget with pixel-style numerals, circular quote widget.
- **Widgets seen:** big clock, pill clock + weekday, circular date with weekday in accent, music pill (play/pause button + track), music card with artwork + progress + controls, RAM dot-grid card, battery dot-grid card ("98% Discharging 2:07"), half-circle RAM gauge, weather pill (28 C, Haze), hi/lo temperature circle (36 C / 21 C), circular calendar day with note ("MAY 09, Birthday of ..."), fun-facts card, circular quote, small scene capsule.
- **Wallpapers seen:** grey organic ink-branch on soft blobs, liquid gold-and-black metal, brushed-metal louvers. Clean, abstract, high contrast, monochrome-leaning.
- **Bars seen:** a pill-shaped centred bar (start button, search pill, app icons) and a status pill (chevron, volume, battery, time). That is dock territory (P2). Note it, do not build it yet. The bar appears at both top and bottom, so position must be configurable.
- Laptop-frame backgrounds in the mockups are presentation only. Do not recreate them.

### 3.3 Reference-matching method

For every widget and every wallpaper:

1. Render ours at the same size as the reference crop.
2. Put them side by side (screenshot tool) and score against the rubric in section 12.3.
3. Iterate until the rubric passes. Record before/after images in the milestone report.

---

## 4. Tech stack (decided; change only via `docs/DECISIONS.md` after a failed spike)

| Layer | Choice | Notes |
|---|---|---|
| App shell, native glue | **Tauri 2 + Rust** (`windows` crate for Win32/WinRT/COM) | One Rust core, lazy-created webview windows |
| UI | **React + TypeScript (strict) + Vite** | CSS variables for all theme tokens |
| Animation | **Motion** (framer-motion successor) + CSS | GPU-friendly transforms only; no layout animation in hot paths |
| State | **Zustand** | Small stores, selectors everywhere, no whole-store subscriptions |
| Persistence | JSON files (settings, layouts, themes) with atomic writes + versioned migrations; SQLite (`rusqlite`) only if needed (clipboard history in P2) | |
| System data | `sysinfo`, PDH counters (GPU), WinRT `GlobalSystemMediaTransportControlsSessionManager` (media), Win32 power status / WinRT battery | |
| Wallpaper set | `IDesktopWallpaper` COM interface (per-monitor) | Native Windows renders the wallpaper. Zero cost, instant at boot |
| Images / color | `image`, `fast_image_resize`, own k-means or Material color utilities for wallpaper tint | |
| Weather | Open-Meteo (forecast + geocoding), no API key | Cache aggressively, show attribution |
| Fonts | Doto (dot-matrix), Geist + Geist Mono (UI), plus a pixel face for date numerals | **Verify each licence is OFL or compatible** and record in `THIRD_PARTY_NOTICES.md`. Never use Nothing's proprietary fonts |
| Updater / installer | Tauri updater + NSIS per-user installer (no admin) | Signed update manifests |
| Tests | `cargo test`, Vitest, Playwright (settings UI), `tauri-driver`/WebDriver or WebView2 CDP for e2e, `pixelmatch` + SSIM for visual diff | |
| Lint/format | `clippy -D warnings`, `rustfmt`, ESLint, Prettier, `tsc --noEmit` | CI gate |
| CI | GitHub Actions `windows-latest` | Build, lint, test, `cargo audit`, `cargo deny`, `pnpm audit` |

### 4.1 Spike gate (P0, mandatory before M1)

Build a throwaway prototype and **measure** that a Tauri/WebView2 overlay can do all of the following. If any fails, log it and move to the next fallback.

1. Fully transparent, borderless window with no taskbar entry.
2. Click-through on empty areas, clickable on widget areas (use `SetWindowRgn` or hit-test regions updated from layout changes; not a full-screen opaque hit target).
3. Sits at desktop level (under normal windows, above wallpaper), interactive when the desktop is visible (Win+D).
4. 60 fps drag/resize of 10 animated widgets on the target machine, p95 frame time under 16.6 ms.
5. Correct at 100/125/150/200% DPI and with two monitors of different DPI.
6. Survives `explorer.exe` restart (re-attach on `TaskbarCreated`).

Fallbacks in order: (a) one webview per monitor with tuned compositing flags, (b) native Win32 host window hosting WebView2 via composition controller, (c) native renderer (Rust + wgpu/Direct2D) for the widget layer with webview only for Settings. Record numbers for each in `docs/spikes/`.

---

## 5. Repository layout

```
D:\dockDock
├─ CLAUDE.md                 # short hard rules, auto-loaded
├─ MASTER_SPEC.md            # this file
├─ PROGRESS.md               # live status
├─ LICENSE                   # GPL-3.0-or-later (owner may override, see DECISIONS)
├─ THIRD_PARTY_NOTICES.md
├─ apps/
│  └─ desktop/               # Tauri app
│     ├─ src-tauri/          # Rust core
│     │  ├─ src/
│     │  │  ├─ boot/         # autostart, startup delay, crash guard, restore
│     │  │  ├─ desktop_host/ # attach/overlay strategies, hit regions, monitors, DPI
│     │  │  ├─ wallpaper/    # IDesktopWallpaper, snapshot, tint
│     │  │  ├─ providers/    # clock, weather, battery, system, media, calendar...
│     │  │  ├─ store/        # settings, layouts, themes, migrations
│     │  │  ├─ ipc/          # typed commands + event channels
│     │  │  └─ main.rs
│     └─ src/
│        ├─ overlay/         # widget canvas (the desktop layer UI)
│        ├─ settings/        # settings app UI
│        ├─ widgets/         # built-in widgets (same API as future third-party)
│        ├─ design-system/   # tokens, primitives, dot-matrix components
│        └─ lib/
├─ packages/
│  ├─ widget-sdk/            # manifest schema, types, hooks (versioned)
│  └─ theme-schema/          # JSON schema + validators for themes, icon packs
├─ assets/
│  ├─ wallpapers/            # generated originals (light/dark pairs)
│  ├─ icons/                 # default icon pack (original)
│  └─ fonts/
├─ design/
│  └─ reference/             # derivatives of the owner's reference images
├─ tools/
│  ├─ restore-windows.ps1
│  ├─ wallpaper-gen/         # reproducible procedural wallpaper generator
│  ├─ capture/               # screenshot + diff + perf logging
│  ├─ measure-boot/          # boot timing harness
│  └─ preflight.ps1          # verifies toolchain, writes BLOCKERS.md on failure
├─ docs/
│  ├─ DECISIONS.md  BLOCKERS.md  HACKATIME_STATUS.md
│  ├─ spikes/  reports/  design/  QA/
└─ .claude/
   ├─ agents/                # sub-agent definitions (section 12.1)
   └─ settings.json          # permissions (appendix B)
```

---

## 6. Environment setup (P0)

Run `tools/preflight.ps1` first. It must check, and on failure write the exact missing item to `docs/BLOCKERS.md` and continue with whatever else is possible:

- Windows 10 22H2+ or Windows 11, build number recorded.
- Rust (rustup, stable, MSVC target), MSVC Build Tools with C++ workload and Windows SDK, WebView2 runtime.
- Node LTS, pnpm (via corepack), Git.
- `wakatime-cli` presence (informational only).
- Writable `D:\dockDock`, free disk space over 10 GB.

If an install needs elevation (UAC) and elevation is not available unattended, do not wait. Log it and continue. The owner pre-installs prerequisites before sleeping, so this should not trigger.

If an ECC ("Everything Claude Code") plugin or similar agent/skill harness is installed, use its agents, skills and commands where they help. If it is not installed, use the sub-agent definitions in section 12.1. Do not depend on it.

---

## 7. Boot behaviour: the core promise

**Requirement:** the user signs in and sees their customised desktop. They never manually launch, enable, or configure anything again. After the one-time onboarding, it is the default. It can be turned off from settings, returning to stock Windows.

### 7.1 What is physically possible (design to this, be honest in UI copy)

Windows draws its desktop before any startup app runs and deliberately delays startup apps by roughly 10 seconds. We remove most of that delay and make the first frame already look like ours.

1. **Real Windows wallpaper = the user's chosen wallpaper.** Set via `IDesktopWallpaper` per monitor. From the first moment Explorer draws the desktop, it is already our wallpaper, never the default one. No app needs to be running for this.
2. **Remove the startup delay.** Set `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Serialize\StartupDelayInMSec = 0` (create the key if missing, snapshot the original). No admin needed.
3. **Launch at logon with zero delay.** Evaluate (a) the `HKCU ...\Run` key and (b) a user-level Task Scheduler logon task. Measure both with `tools/measure-boot` and pick the faster, more reliable one. Document the numbers in `docs/spikes/autostart.md`.
4. **Tiny fast start path.** A lightweight Rust launcher/core starts before the webview. It reads the saved layout and shows the overlay with a fade-in as soon as the webview is ready. Widgets use cached last-known data instantly, then refresh. No spinners on the desktop, ever.
5. **Optionally hide stock desktop icons** (setting, off by default). Must restore on exit and in the panic routine.

**Realistic target:** the user's wallpaper is visible immediately; widgets appear within 1.5 s of the desktop being shown, with cached data, no placeholder flash. Claim nothing better in UI or docs. The sign-in screen is Windows's and is out of scope.

Replacing `explorer.exe` as the shell would remove all delay but is risky. Out of scope for v1. Record it in `docs/DECISIONS.md` as a future advanced option only.

### 7.2 Onboarding (shown once)

Three short steps, under 60 seconds total:

1. **Choose look:** pick a theme + wallpaper (live preview applies to the real desktop).
2. **Make it default:** one explanation screen, one confirmation button. Performs: wallpaper snapshot, autostart registration, startup-delay key, desktop-host start. Optional location permission for weather (skippable, with manual city search).
3. **Done:** shows where Settings lives (tray icon + global hotkey + right-click on desktop widget area) and how to switch back to Windows.

No further prompts after this. Ever.

### 7.3 Switching back to Windows (Settings → Startup & Windows)

One toggle: "Use our desktop" ↔ "Use Windows desktop". Turning it off: restores the wallpaper snapshot, shows desktop icons, removes autostart and the startup-delay change, closes the overlay, and keeps settings so turning it back on is instant. A separate "Uninstall helpers / reset everything" action exists for cleanup. The installer's uninstall must run the same restore routine.

### 7.4 Resilience

- Re-attach after `explorer.exe` restart (listen for `TaskbarCreated`).
- Handle sleep/resume, monitor hot-plug, DPI change, resolution change, RDP connect/disconnect, lock/unlock, fast user switching. Re-layout without flicker; never lose widget positions.
- Single instance. A second launch focuses Settings.
- Pause rendering when a fullscreen/D3D app is running (`SHQueryUserNotificationState`), when the screen is locked or off, and optionally on battery saver. Resume instantly with no jump.
- Never block the UI thread on I/O. Provider failures degrade to a designed "unavailable" state, never a crash or blank.

### 7.5 Testing boot without rebooting

Do not reboot or sign out. Simulate: kill the app, start it via the exact same command line as the autostart entry, kill and restart `explorer.exe`, trigger display-change and resume messages, and measure elapsed time to first widget paint with `tools/measure-boot`. Create `docs/QA/BOOT_MANUAL_TEST.md` with the exact steps for the owner to do one real reboot in the morning, and what numbers to expect.

---

## 8. Architecture

### 8.1 Processes and windows

- **Core (Rust):** boot, desktop host, wallpaper, providers, store, IPC, crash guard, tray icon. Always running. Small.
- **Overlay UI:** one transparent webview per monitor hosting the widget canvas (never one webview per widget). Created at start, kept alive.
- **Settings UI:** separate webview window, created on demand, destroyed on close (frees memory, keeps desktop path lean).
- **Providers** run in Rust, push throttled typed events to the overlay via Tauri channels. Frontend never polls.

### 8.2 Desktop host strategies (`desktop_host/`)

Implement as a trait with interchangeable strategies, selected by capability test at startup, with a manual override in an advanced setting:

- **S1:** parent/attach the overlay to the desktop window host (`Progman`/`WorkerW`; the arrangement changed in Windows 11 24H2, so detect and handle both layouts).
- **S2 (fallback):** a bottom-most borderless tool window (`WS_EX_TOOLWINDOW`, `WS_EX_NOACTIVATE`, `HWND_BOTTOM`) with a z-order guard that re-asserts position on focus changes.

Acceptance test matrix for any strategy: widgets receive click/drag/hover/scroll; desktop icons remain usable in empty areas; Win+D reveals widgets; widgets never draw above normal app windows; multi-monitor and mixed DPI; survives explorer restart.

### 8.3 Hit-testing

Overlay is click-through except over widget rectangles. Keep a Rust-side region (`SetWindowRgn` union of widget rects plus edit-mode handles) updated on layout changes with a debounce under one frame. Verify no dead zones and no stolen clicks with an automated click sweep test.

### 8.4 Glass without OS acrylic

OS acrylic/mica on a bottom-most window is laggy and inconsistent. Because we control the wallpaper, render "glass" widgets with a **pre-blurred crop of the actual wallpaper** as the widget background (computed in Rust on wallpaper change, cached per monitor), plus tint and noise. Zero per-frame cost, identical on Windows 10 and 11. This is the default glass method.

### 8.5 Data model (all schema-versioned, migrated, atomic-write, backed up)

- `settings.json`: global settings.
- `layouts/<profile>.json`: per-monitor widget placements, sizes, per-widget config.
- `themes/*.json`: token sets validated against `packages/theme-schema`.
- `wallpapers/`: user-imported originals + generated derivatives (resized, blurred crops, tint palette).
- `iconpacks/<name>/`: `iconpack.json` + image files.
- Corrupt file → load last good backup, show a one-time non-blocking notice, never crash.

### 8.6 Widget system (built-ins use the same API third parties will use later)

Manifest (`widget.json`):

```json
{
  "id": "builtin.clock",
  "name": "Clock",
  "version": "1.0.0",
  "hostApi": "^1.0.0",
  "sizes": [
    {"id": "m",  "w": 4, "h": 2},
    {"id": "l",  "w": 4, "h": 4},
    {"id": "xl", "w": 8, "h": 4}
  ],
  "settingsSchema": "settings.schema.json",
  "providers": ["time"],
  "permissions": [],
  "defaults": {"style": "split-bold", "hour24": true}
}
```

Rules:

- Each size has its **own designed layout**, not a scaled copy.
- Widget components are pure functions of (props, provider data, tokens). No direct network or file access; they ask providers.
- Settings forms are generated from `settingsSchema`, so every widget is customisable with no extra UI work.
- Third-party loading/sandboxing is out of v1, but the manifest, SDK package and API versioning must make it possible later.

### 8.7 Grid and layout engine

- Fixed logical grid (choose the unit in a design spike, e.g. 20 px cell with 8 px gap, scaled by DPI), size classes defined in cells.
- Drag, snap, alignment guides, collision handling (push-away or swap, user-selectable), edge/safe-area margins (respect the native taskbar and any reserved areas), per-monitor layouts, lock mode, undo/redo (50 steps), duplicate, copy size/style.
- **Edit mode:** right-click the widget area or press the global hotkey. Widgets show handles; a gallery drawer slides in. Leaving edit mode saves. Drag at 60 fps with transforms only.
- Resize: corner/edge handles snapping to the widget's declared sizes (and optionally free-resize within min/max for widgets that allow it).
- Layout profiles: "Work", "Focus", "Minimal", user-defined; switch by hotkey or settings.

### 8.8 Theme engine

Tokens (CSS variables, generated from a theme JSON):

- Colors by role: `bg`, `surface`, `surface-2`, `border`, `text`, `text-dim`, `accent`, `accent-ink`, `dot-on`, `dot-off`, `danger`, `success`. Derived in OKLCH so auto-tints stay harmonious.
- Shape: `radius-pill`, `radius-lg/md/sm`, `dot-size`, `dot-gap`.
- Type: families, scale, tracking, dot-matrix style per use.
- Space: spacing scale. **No magic numbers in components.**
- Effects: glass blur amount, tint, noise, shadow, border.
- Motion: durations, easings, spring presets; honours OS "reduce motion".

Built-in themes: **Paper** (light grey + red accent), **Obsidian** (dark mono), **Aurum** (dark + gold), plus **Auto-tint** (accent and surfaces derived from the current wallpaper). Light/dark follows the system or a manual pick, and can follow a schedule. Import/export `.theme.json` files. Live preview on the real desktop while editing.

---

## 9. Phase 1 feature specs: the Home Screen Release

### 9.1 Wallpapers

- Ship at least **12 original wallpapers** as light/dark pairs, in 4K and 21:9 variants, generated by a reproducible, seeded generator in `tools/wallpaper-gen` (shader/canvas/numpy; your choice). Styles to cover: organic ink-and-branch on soft blobs, liquid metal (gold/silver/black), brushed-metal louvers, dot-matrix gradient fields, soft monochrome gradients, paper grain, glass orbs, topographic lines.
- Do not copy any reference image. Match the **mood and quality**, compare side by side per section 3.3, and iterate until the rubric passes.
- User import: drag-and-drop or file picker for PNG/JPG/WebP/AVIF/BMP/GIF (static frame for GIF). Fit modes (fill, fit, stretch, tile, center, span across monitors), per-monitor assignment, crop/position editor with live preview, auto light/dark pairing detection, and removal of imported items.
- On set: generate derivatives (resized to the monitor, blurred glass crops, palette for Auto-tint) in a background task with a progress state. Never block the UI.
- Snapshot of the user's original wallpaper is stored at onboarding and is never overwritten.
- Scheduled rotation / folder slideshow: stretch goal if time allows, off by default.

### 9.2 Widgets (all must work with real data; no fake values)

| Widget | Sizes | Data / behaviour |
|---|---|---|
| **Clock** | M, L, XL | Styles: split-bold dot-matrix, striped-line, filled-circle dots, pill digital, minimal analog-dot. 12/24h, seconds, leading zero, multiple time zones, blinking colon option |
| **Date** | S circle, M pill | Pixel-numeral date, weekday in accent, locale-aware |
| **Calendar** | S circle (today + note), M, L month grid | Local only in v1: system locale, week start, import `.ics` file(s) or folder, show next events. Google/Outlook sign-in is v2, design the provider interface for it |
| **Weather** | S pill, M, L | Open-Meteo: current, hi/lo, hourly strip, 5-day, feels-like, wind, UV, AQI where available. Units, manual city search or optional OS location. Cache and stale-while-revalidate |
| **Battery** | S pill, M, L dot-grid | Percent, charging/discharging, time remaining, power plan. Hidden gracefully on desktops without a battery |
| **System** | S half-circle, M, L dot-grid | RAM, CPU, disk (per drive), network up/down, GPU (best-effort via counters, hidden if unavailable), top process. 1 Hz default, user-tunable |
| **Music** | S pill, M, L card | System media session: artwork, title, artist, progress, play/pause/next/prev, seek. Accent can follow artwork. Works with Spotify, browsers, media players |
| **Quote** | S circle, M | Bundled curated offline set (public-domain or properly attributed), plus user-defined list. Daily or hourly rotation |
| **Fun fact** | M, L | Bundled curated offline set (original or public-domain facts, each with source note), rotation |
| **Notes** | M, L | Persistent sticky notes, lightweight formatting, multiple notes, pin, colors from theme |
| **To-do** | M, L | Local lists, check/uncheck animation, drag reorder, due dates |
| **Timer / Pomodoro** | S, M | Stopwatch, countdown, Pomodoro with sessions; survives restart; optional sound (original sound assets) |
| **Photo frame** | S, M, L | User folder slideshow, fit modes, transitions |
| **World clocks** | M | Up to 4 cities, day/night dot indicator |

Per-widget common options: style variants, accent override, text scale, opacity, glass on/off, corner roundness, show/hide labels, tap action (open app/URL/folder), refresh interval where relevant. Every widget has designed **loading-from-cache**, **empty**, **error**, **permission-denied** and **offline** states.

Interactions: hover micro-animation, click actions where it makes sense (play/pause, open calendar day, start timer), right-click context menu (edit, duplicate, remove, size, style).

### 9.3 Icons and icon packs

- Define `iconpack.json` (name, author, version, license, icon list, mapping rules by exe name, AUMID, app name, or file extension, fallback behaviour) and a folder format of PNG/SVG/ICO.
- Settings → Icons: pick a pack, import a pack folder/zip, per-app override with a visual picker, remove, reset.
- Ship a high-quality **default pack** of original icons (system symbols, generic app, folder, file types, common utility glyphs) in the Nothing-adjacent dot/mono style. Do not ship third-party brand logos.
- **Monochrome / dot-treatment filter:** optional mode that renders any native app icon through a mono or dot-matrix filter in the active theme colors, so unknown apps still look consistent.
- Icon packs are used by the dock in P2 and by widget tap-action pickers in P1. Build the system and its Settings UI now.

### 9.4 Network calls (the only ones allowed)

- Open-Meteo forecast and geocoding (weather widget, only if the weather widget is in use). Show the required attribution in About and in the widget details.
- Update manifest check (can be turned off).
- Nothing else. No analytics, no crash upload. "Copy diagnostics" produces a local text bundle the user can share manually.

### 9.5 Settings app (Settings window, instant-apply, searchable)

Pages:

1. **Home:** layouts/profiles, add/remove widgets, edit mode shortcut, per-monitor controls.
2. **Appearance:** theme picker, full theme editor with live preview on the real desktop, light/dark/schedule, Auto-tint, glass settings, fonts, radii, dot size, motion.
3. **Wallpapers:** library, import, per-monitor, fit modes, crop editor.
4. **Icons:** packs, mapping, monochrome filter.
5. **Widget gallery:** every widget with live preview, size picker, one-click add.
6. **Startup & Windows:** "Use our desktop / Use Windows desktop" toggle, launch behaviour, hide desktop icons, safe mode, **Restore Windows desktop** button, boot timing readout.
7. **Displays:** per-monitor layout, safe areas, DPI notes.
8. **Performance:** frame stats, pause rules (fullscreen, battery saver, lock), provider refresh rates.
9. **Data & privacy:** what is stored, where, export/import all settings, reset, delete cache.
10. **Shortcuts:** global hotkeys (edit mode, open settings, switch profile), all rebindable, conflict detection.
11. **About:** version, licences (including Open-Meteo, fonts), diagnostics, check for updates, links.

Settings UI rules: keyboard navigable, screen-reader labels, visible focus, designed with the same token system as the desktop (dogfood the design system), no jank on slider drag (transform/opacity updates, throttled persistence), undo for destructive actions, no setting that does nothing.

### 9.6 System integrations in P1

- Tray icon (open Settings, edit mode, switch profile, pause, restore Windows, quit).
- Global hotkeys with sane defaults and conflict handling.
- Start with Windows toggle (backed by section 7).
- Per-user NSIS installer, portable zip, uninstall runs the restore routine.
- Auto-update via Tauri updater (signed), can be disabled.

---

## 10. Milestones (P0 and P1)

Each milestone ends with: tests green, section 12 gates passed, `docs/reports/<m>.md` written, git tag.

| # | Milestone | Key outputs |
|---|---|---|
| M0 | Foundations | Preflight, repo scaffold, CI, sub-agents defined, `restore-windows.ps1` tested, Hackatime read-only check, reference inventory, **spike results and strategy decision** |
| M1 | Desktop layer | Transparent overlay, desktop host strategy chosen, hit regions, multi-monitor + DPI, explorer-restart recovery, fullscreen pause |
| M2 | Boot flow | Wallpaper snapshot + set via `IDesktopWallpaper`, autostart, startup-delay key, crash-loop guard, restore routine, onboarding shell, simulated-boot timings |
| M3 | Design system + theme engine | Tokens, primitives, dot-matrix components, fonts licensed, built-in themes, auto-tint, import/export |
| M4 | Widget engine | Manifest + SDK, providers framework, grid, edit mode, drag/resize/snap/undo, profiles, persistence + migrations |
| M5 | Widgets, batch 1 | Clock, Date, Battery, System, Weather (each fully polished, reference-matched) |
| M6 | Widgets, batch 2 | Music, Calendar (local/ICS), Quote, Fun fact, Notes, To-do, Timer, Photo frame, World clocks |
| M7 | Wallpapers + icons | Generator + 12 originals, import/crop/per-monitor, icon pack system + default pack + mono filter |
| M8 | Settings app | All pages, live preview, search, shortcuts, tray, installer + updater, About/licences |
| M9 | Hardening | Soak tests, full matrix, perf pass, a11y pass, bug bash with two fresh reviewers, release candidate |
| G1 | **Home Screen Release gate** | Section 14 checklist |

Order is mandatory because each layer depends on the one before. Within a milestone, parallelise with sub-agents but keep merges serial and gated.

---

## 11. Phase 2 preview: the Dock (do not start before G1)

The dock replaces the Windows taskbar and is the main "environment". It is mac-style, built into one surface, with CoolDock-inspired capabilities (inspired by the idea, original design and code). Refine this spec into its own `docs/DOCK_SPEC.md` at the gate.

**Core:** hide the native taskbar (restore on exit/crash), register as an app bar (`SHAppBarMessage`) or float without reserving space (setting), position top/bottom/left/right, per-monitor docks, auto-hide, hover magnification with spring physics, running indicators and badges via shell hooks (`RegisterShellHookWindow`), icon extraction via shell image factory, drag reorder, folders/stacks, right-click menus, window thumbnails via DWM thumbnail API, click-to-minimise/restore, multi-profile docks.

**Built-in widgets/tools (each a real feature, each fully polished):** search launcher (apps, files, calculator, web, hotkey), now playing, calendar/meetings, to-do + reminders, Pomodoro, hydration reminder, notes, clipboard history (respect clipboard "exclude from history" hints, never record password-manager content), file shelf (temporary drop zone), downloads, screenshots (Windows.Graphics.Capture), voice memo, quick toggles (Wi-Fi, Bluetooth via radio APIs, volume via Core Audio, brightness), color picker, unit/currency converter, calculator, emoji, clocks, weather, system stats.

**Known hard areas (design and spike first):** system tray icons (Windows 11 has no public API), notification center (needs package identity), live window previews, Win-key/Start menu stays native in v1 of the dock.

Status pill (volume, battery, time, chevron) and the centred pill bar seen in the references are dock-phase deliverables.

---

## 12. Quality system

### 12.1 Sub-agents (create `.claude/agents/*.md` at M0)

Short, sharp role prompts. Use the strongest available model for architect and reviewers.

| Agent | Responsibility |
|---|---|
| `architect` | Owns design docs, API shapes, schemas, decisions. Rejects hacks |
| `rust-shell` | Win32/WinRT/COM, desktop host, boot, providers. Safety-first, unsafe blocks justified in comments |
| `ui-builder` | React/TS UI, design system, widgets, settings. Uses tokens only |
| `wallpaper-artist` | Wallpaper generator, palette, reference comparison |
| `test-writer` | Unit, integration, e2e, click-sweep, visual regression |
| `perf-profiler` | Frame time, CPU, GPU, memory, startup, after every feature |
| `visual-qa` | Screenshots, side-by-side against references, rubric scoring |
| `reviewer-a` | Code review with checklist. Sees diff + spec |
| `reviewer-b` | Fresh-context adversarial reviewer. Does not see reviewer-a or builder reasoning. Tries to break the feature |

### 12.2 The double-check protocol (every feature, no exceptions)

1. **Build** (builder agent) + unit/integration tests.
2. **Self-verify** on the real machine: run it, use it, screenshot it.
3. **Reviewer A:** code review against the checklist below.
4. **Visual QA + perf:** rubric score (12.3), frame/CPU/memory numbers vs section 13.
5. **Reviewer B (fresh context):** adversarial pass: odd inputs, rapid interaction, DPI changes, monitor unplug, sleep/resume, offline, missing permission, huge/small values, locale and RTL text.
6. Log everything in `docs/QA/<feature>.md`. Merge only when all steps are green. A regression found later reopens the feature.

Reviewer checklist: correctness, error handling, no UI-thread blocking, no leaks (listeners, timers, handles), no magic numbers, tokens only, accessibility, state persisted and migrated, copy quality, dead code, tests meaningful, licence of every new dependency or asset.

### 12.3 Visual rubric (score 1 to 5, all dimensions must be at least 4, average at least 4.5)

Fidelity to the reference mood; typography and dot-matrix craft; spacing/rhythm on the grid; color and contrast in light and dark; motion quality; state completeness (empty/loading/error); consistency with sibling widgets; originality (not a copy).

### 12.4 "No AI slop" definition (hard rules)

- No placeholder or lorem text, no fake data shown as real, no `TODO`/`FIXME` in merged code, no commented-out code, no unused settings, no dead branches.
- No generic gradients, stock-emoji icons, default component-library looks, or inconsistent radii.
- Copy is short, specific and human. No "Oops!", no exclamation spam, no filler.
- Every number on screen is real and correctly formatted for the locale.
- Every setting works, persists, and can be reset.
- Every error has a designed state and a useful message.
- Every dependency and asset has a recorded licence.

### 12.5 Test matrix (M9)

Windows 10 22H2, Windows 11 23H2, Windows 11 24H2 or later; DPI 100/125/150/200%; single and dual monitors with mixed DPI; 16:9, 16:10, 21:9, 4K; light/dark/high-contrast/reduce-motion; battery and no-battery; online/offline; low-end hardware pass (throttle CPU to simulate). If the machine cannot cover a row, state which rows were not covered in the final report instead of pretending.

Soak test: 8 hours running with all widgets, sleep/resume cycles simulated, memory and handle counts flat.

---

## 13. Performance targets

RAM is not a goal. These are **alarm thresholds**, not constraints on quality.

| Metric | Target | Alarm |
|---|---|---|
| Frame time during drag/resize/animation | p95 under 16.6 ms (design for 120 Hz-capable) | p95 over 20 ms |
| Idle CPU, 8 widgets | under 1% average | over 3% |
| Overlay first paint after shell ready | under 1.5 s with cached data | over 3 s |
| Settings window open to interactive | under 400 ms | over 800 ms |
| Total working set, 8 widgets, all processes | under 300 MB | over 500 MB (investigate, do not cut quality unless leaking) |
| Memory growth over 8 h | flat (under 5%) | any monotonic growth |
| GPU when desktop hidden or fullscreen app active | effectively 0 | any sustained usage |

Use transforms/opacity for animation, virtualise lists, throttle provider updates to what the UI can show, pause hidden work, avoid layout thrash, avoid re-render fan-out (selectors, memoisation where measured). Measure before optimising; record before/after.

---

## 14. Gate G1: Home Screen Release checklist

All must be true, with evidence in `docs/reports/G1.md`:

- [ ] Boot promise: after onboarding, simulated cold start shows the user's wallpaper immediately and widgets within the target, with zero manual action. Panic restore, crash-loop guard, safe mode, and "Use Windows desktop" toggle all tested.
- [ ] All 14 widgets work with real data, every size, every state, in all three built-in themes.
- [ ] Widgets visually pass the rubric against the reference files.
- [ ] 12+ original wallpapers, import, crop, per-monitor all working. Auto-tint works.
- [ ] Icon pack import and mapping work, default pack shipped, mono filter works.
- [ ] Settings app: all pages functional, instant-apply, searchable, keyboard navigable.
- [ ] Drag/resize/snap/undo/profiles are smooth at the performance targets.
- [ ] Explorer restart, sleep/resume, monitor hot-plug, DPI change all recover cleanly.
- [ ] 8-hour soak clean. Test matrix covered or gaps stated.
- [ ] Installer, uninstall (runs restore), updater, signed manifests, portable build.
- [ ] No open critical or high bugs. `cargo audit`, `cargo deny`, `pnpm audit` clean or exceptions documented.
- [ ] `THIRD_PARTY_NOTICES.md` complete. README, user guide, and a "Switching back to Windows" doc written.
- [ ] Marketing capture pipeline exists (`tools/capture`): scripted 4K screenshots and short screen recordings of each widget/theme, for the future website.

---

## 15. Gate for P2 (Dock)

Write `docs/DOCK_SPEC.md` (taskbar replacement strategy, app-bar behaviour, failure modes, restore guarantees), run spikes for hover thumbnails and shell hooks, prove the native taskbar is restored on every exit path including a hard kill, then build in the same milestone/gate discipline as P1. The dock is judged by the same rubric and the same double-check protocol.

---

## 16. Phase 3: Agent Island (last job in v1)

Reference: `https://github.com/1413jean/agent-island` (MIT, Swift/SwiftUI, macOS-only). **Its code cannot run on Windows**, so this is a port of the design and protocol, not a copy-paste. Clone it read-only into `references/agent-island/` for study.

**Licence duty:** MIT permits reuse and modification. Keep the original copyright and licence notice for anything copied or closely derived, add an entry to `THIRD_PARTY_NOTICES.md`, and check the licence of any sounds or art before reusing them. Prefer original art in our Nothing-style dot-matrix language.

**What it does:** a status island that sits at the top, collapsed when idle, expanding when Claude Code (and Codex) is working. It shows state (thinking, reading/searching, editing/writing, running command, done, paused, usage limit reached, login/connection error, stopped/ready), the current file or command, tokens this turn, multi-session switching, done sound + notification that returns you to the right terminal, and settings for appearance and size.

**Windows adaptation:**

- No notch exists, so build a **top-centre pill** that grows into an island with spring animation, collapses to a tiny pill or hides (setting), moves aside on hover, follows the cursor across monitors, themed with our tokens.
- **Protocol:** Claude Code hooks (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionEnd`, `Notification` idle) write per-session JSON state files under `%USERPROFILE%\.claude\tools\island\sessions\`. The app watches that folder with a file watcher (not a 150 ms poll). Interruptions, usage limits, API errors and token counts come from reading Claude Code's transcript. Codex tasks come from its local session logs. Verify exact paths and formats against the current Claude Code and Codex versions at build time, because they change.
- **Hook runner:** the original uses Python. Do not require Python on Windows. Ship a tiny bundled `island-hook.exe` (Rust) and register its absolute path.
- **Connect / Disconnect flow:** back up the user's `settings.json` before writing, touch only our own hook entries, and remove only those on Disconnect. During development, run all of this against a temp config directory, never the live file.
- **Privacy:** reads local files only, makes no AI calls, spends no tokens, no network.
- **Pixel/dot state icon:** original dot-matrix animations in our style for each state (an optional "pixel creature" is fine if it is original).
- Windows notification with click-through to the right terminal window/tab where feasible (Windows Terminal, VS Code, others), and a graceful fallback to focusing the terminal.

Same gates, same rubric, same double-check protocol.

---

## 17. Legal and IP rules

- Original assets only. Do not copy Nothing's wallpapers, icons, widget art, fonts (Ndot etc.), or branding. Do not copy code or assets from NThing-UI, CoolDock or any reference product. They are visual and functional **inspiration** only.
- Every dependency, font, sound and image gets a licence entry. OFL/MIT/Apache-2.0/BSD are fine. Anything unclear is excluded.
- Open-Meteo attribution is required.
- Disclaimer in About and README: not affiliated with or endorsed by Nothing Technology Limited.
- Project licence defaults to GPL-3.0-or-later (keeps it free and stops closed-source resale), recorded in `docs/DECISIONS.md` as owner-overridable. It is compatible with the MIT-licensed code we may port.

---

## 18. Risks and fallbacks

| Risk | Mitigation |
|---|---|
| Desktop-attach behaviour differs across Windows builds (esp. 24H2+) | Two strategies, capability detection, test matrix, manual override |
| Windows update breaks a shell trick | Fallback strategy, version log in diagnostics, regression test script |
| WebView2 transparency / click-through limits | Spike gate with ranked fallbacks (section 4.1) |
| User locked into a broken desktop | Panic script, crash-loop guard, safe mode, restore on uninstall |
| Antivirus false positives (autostart + shell changes) | No admin, no injection, no hooks into other processes, code signing before public release (evaluate free OSS signing programs), clear docs |
| Fullscreen games hit by overlay | Fullscreen detection, full pause, GPU release |
| Provider API changes (weather, media) | Provider abstraction, cached last-good data, designed error states |
| Context loss in long unattended runs | `PROGRESS.md`, small commits, milestone reports, decisions log |

---

## Appendix A: Kickoff prompt (paste into Claude Code from `D:\dockDock`)

```
Read CLAUDE.md, then MASTER_SPEC.md fully, then PROGRESS.md if it exists.
Run preflight, create the sub-agents, then execute milestones M0 through M9 in order,
following the autonomy contract, the double-check protocol and every gate.
Do not ask me questions. Log decisions and blockers in docs/. Update PROGRESS.md
and commit after every feature. Stop at gate G1 and write docs/reports/G1.md.
```

## Appendix B: `.claude/settings.json` (permissions)

```json
{
  "permissions": {
    "defaultMode": "bypassPermissions",
    "allow": ["Bash", "Read", "Edit", "Write", "WebFetch", "WebSearch"]
  }
}
```

Alternative launch: `claude --dangerously-skip-permissions` from `D:\dockDock`. Verify the active mode with `/permissions`. Because this removes prompts entirely, the safety rails in sections 1.1 and 1.2 are the protection. Treat them as binding.

## Appendix C: Conventions

- Commits: Conventional Commits (`feat:`, `fix:`, `perf:`, `refactor:`, `test:`, `docs:`, `chore:`). One feature per branch `feat/<name>`, merged to `main` only after the gates.
- Rust: `clippy -D warnings`, no `unwrap()` outside tests, errors typed with `thiserror`, `unsafe` only with a safety comment.
- TypeScript: `strict`, no `any`, no default exports for components, one component per file.
- All user-facing strings go through i18n scaffolding (English first).
- Every PR/commit that adds a dependency updates `THIRD_PARTY_NOTICES.md`.

# Next session: finish and publish dotDock V1

Written 2026-11-21 22:40 by the lead, for the next lead session. Read this first; it replaces reading the history
(`docs/HANDOFF.md` is the older 2026-11-20 handoff). Rules still apply: `CLAUDE.md`, `docs/AGENT_RULES.md`.
Owner wants **V1 published, no bugs, budget is tight.** No new features. Agents always on model `opus`.
The owner watches live tests on screen.

## Where things stand

Every track's own work is finished. Everything V1 is merged on ONE integration branch:

- **Integration worktree:** `D:\dotDock\.claude\worktrees\agent-ada7f4cb99f8b50da`
  (branch `worktree-agent-ada7f4cb99f8b50da`, cargo target dir `.cache/target-v1`, GNU toolchain via
  `tools/env-gnu.sh`; there is no local MSVC, CI builds MSVC).
- Already merged into it (all six): theme+settings `44803a5`, notch `49c09f4`, dock host+UI `7514825`,
  release `b568720` (v1.0.0 + signed updater), home `a9d20c8`, website `6b4a5a3`.
- `.gitattributes` (LF) was added on purpose (the theme branch had converted about 60 files to CRLF); merges use
  `git merge --no-ff -X renormalize`.
- **The integration agent was mid-work when the session ended** (it stops with the session). Its remaining jobs:
  1. Re-merge the website at its final hash **`9b8ceca`** (branch `worktree-agent-a81d99eac949307ec`; includes the
     changelog fixes (bottom-only dock, one switch),
     `0aa94d1`, the /license blank-gap fix, and the flattened scenes).
  2. Wallpaper follow: the core listens for `WM_SETTINGCHANGE` + `SPI_SETDESKWALLPAPER` (event-driven, no polling)
     and emits one debounced wallpaper-changed event; the theme re-derives the palette (`palette.ts`,
     `wallpaperTheme.ts`, `applyWallpaperTheme`) and repaints dock and widgets in one frame. It must ignore dotDock's
     own wallpaper writes and never overwrite the user's saved original. Rust + TS tests.
  3. Wallpaper path guard: every code path that sets the wallpaper (Rust handover/theme/restore, sentinel,
     `tools/restore-windows.ps1`) refuses a non-absolute or missing path and falls back to the saved copy; the
     restore script checks afterwards that the registry `WallPaper` file exists. (Incident this session: an
     agent's bash command set the wallpaper to `:LOCALAPPDATA\...` and the owner's desktop went black.)
  4. **Remove the "Use the Windows taskbar" switch entirely** (owner decision, V2 item): no UI, strings, tests or
     dead commands. Settings ends with only the theme on/off switch. Keep the dock host's D0 taskbar safety path.
  5. Cleanups: no gradients left (two were in `Island.css`; `noGradients.test.ts` must scan CSS + TS/TSX/SVG); no
     developer-tile or opt-in cards anywhere in the V1 dock gallery or Settings.
  6. Explain or remove the one skipped vitest test.
  6b. CSP: add `media-src 'self' blob:` to `tauri.conf.json` (the voice-memo tile plays recordings from a blob URL,
     blocked without it) plus a vitest that checks the CSP.
  7. Gate: `tsc --noEmit`, full `vitest run`, `vite build`, `cargo fmt --check`,
     `cargo clippy --all-targets -D warnings`, `cargo test` (the `dotdock_lib` test binary failing with
     `STATUS_ENTRYPOINT_NOT_FOUND` is a known GNU environment issue; that crate has no tests), website `pnpm build`
     + tests + `astro check`. Then build the exe: `cargo build -p dotdock --release --features tauri/custom-protocol`.

**First action:** in that worktree run `git log --oneline -15` and `git status`, see which of 1 to 7 are done,
finish the rest (one fresh Opus agent, or yourself), then run the gate.

## Then: the lead's live test (owner watching, human pace)

Only one dotDock running (`tasklist | grep -i dotdock`). Wind Meadow wallpaper as backdrop. Snapshot the owner's
wallpaper first; `tools/restore-windows.ps1` (has `-DryRun`) restores everything. Screenshots to
`docs/QA/v1-live/`, one pass/fail row per step. Fix any real failure before moving on.

1. Start: the dock appears quickly at the bottom with the frosted macOS-style glass plate, **no grey sheet** over
   the desktop, desktop clicks pass through with every dock panel open and closed, taskbar hidden, notch at the top.
2. Home screen edit mode (never tested live before): open edit mode, **+ Widgets** adds a widget, move widgets
   freely, resize, remove, undo toast, clicking away deselects (no stuck selection), toolbar and drawer stay inside
   the work area.
3. Music widget: play audio in a browser tab; play/pause, next and previous control it and the widget updates;
   close the tab and the widget shows "Nothing playing"; restart playback and it comes back.
4. Wallpaper follow: with widgets out, change the wallpaper through Windows Settings 4 times (Wind Meadow, a dark,
   a light, the owner's own); widget and dock colours follow each time, no flash.
5. Theme off then on, 3 times: off brings the owner's own wallpaper back with taskbar auto-hide ON; on brings
   dotDock's back. Check the real Windows wallpaper after every step (it must never be lost).
6. Notch: expand, hover, right-click, media/timer states; watch the first expansion for a stutter.
7. Dock: launch, focus, minimise apps, running dots, hover labels, right-click menu, stacks, customise (⋯) panel.
8. Run `tools/restore-windows.ps1` and confirm the owner's wallpaper, taskbar and auto-hide are back.

## Then: release and deploy

1. Merge the integration branch into `main` (`git merge --no-ff`), run the gate on main, `git push origin main`.
2. `git tag v1.0.0 && git push origin v1.0.0`. `.github/workflows/release.yml` builds MSVC on CI and publishes
   `dotDock_1.0.0_x64-setup.exe`, its `.sig`, `dotDock_1.0.0_x64-portable.exe` and `latest.json` (about 15 to 20
   min). Secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty) are already set.
   Watch with `gh run watch`.
3. Replace the auto-generated release notes (hundreds of commit titles) with the written ones:
   `gh release edit v1.0.0 --notes-file docs/release-notes/v1.0.0.md`. Check its claims still match what shipped
   (wallpaper follow must really work).
4. In `website/` run `node tools/release-data.mjs` (adds date, size, SHA-256), commit, push.
5. Vercel: the project is **already created and linked** (done 22:55): `dotdock`, id
   `prj_tASXGC6S4bWI8SgjFQWs8JX2bA4x`, team `naitiklearns-projects` (`team_kMhof5qb7z3Fnd4K92551OeJ`), GitHub
   `nAItiklearn/dotDock`, root `website`, Astro, Node 24.x, install `npx --yes pnpm@12.16.1 install --frozen-lockfile`, build
   `npx --yes pnpm@12.16.1 build` (Vercel's own pnpm cannot read the pnpm 12 lockfile; verified 23:05 with a preview
   build of website `9b8ceca` from branch `website-v1-preview`: READY in 40 s, pages 200, `/api/visits` 200
   `{"available":false}`),
   protection on previews only (the production URL is public). **Any push to `main` deploys production**, so push
   `main` only after the integration branch is merged and green. `KV_REST_API_URL` / `KV_REST_API_TOKEN` are
   optional (visit counter; the site runs cleanly without them). Leave `DOTDOCK_OWNER_PHOTOS` unset. Watch the
   build with the Vercel MCP `list_deployments` / `list_deployment_events`.
6. Verify on the live URL: every page loads, the download buttons download the real installer and portable exe,
   no console errors.
7. Update `PROGRESS.md` and `docs/STATUS.md`. Tell the owner the live URL.

## Owner must know

- **Back up the updater signing key** `%LOCALAPPDATA%\dockDock\release\dotdock-updater.key` off this laptop. If it
  is lost, installed copies can never verify an update.
- The installer is unsigned (no code-signing certificate): SmartScreen warns on first install.
- Videos (main theme video, dock clip, notch clip) are deferred; the owner will make them later.

## Decisions taken this session (details in `docs/DECISIONS.md`)

- D-037: developer tiles (GitHub, Vercel, AI tokens) move to V2; branch `worktree-agent-a60a1abdd36a54bde` kept.
- D-038: the website ships with a short first-scroll hitch (worst frame 133 to 409 ms, median 17 ms; Lighthouse
  100/100/100 on all 7 pages). V2: smaller back-layer tiles.
- The taskbar switch is removed from V1 (V2 item). New dock tile types from the owner's wishlist
  (`docs/design/reference/owner-dock-tiles-wishlist-2026-11-21.png`) are V2.
- The native DWM glass plate is dropped; Glass is the CSS frosted plate (the native one drew a grey sheet over the
  whole monitor).

## Known remaining items (not blockers)

- Notch: 2 single dropped frames (33 ms) on the first hover in the 180 s soak; an on-page warm-up was added after
  that run and has not been re-measured (`bash tools/capture/island-soak-run.sh`).
- Dock: cold start about 3.7 s in a debug build (2.3 s of it is WebView2 starting); no release-build numbers yet.
- Theme: the root cause of "theme on after off did not re-apply dotDock's wallpaper" was not found; the fix makes
  it fail safely (the record is kept, the user's wallpaper is never lost). Watch it in live-test step 5.

## Housekeeping

- Disk D: about 32 GB free; stop builds under 12 GB. Finished worktrees can be removed after release
  (`git worktree list`); `agent-a8cff6d57645abbf7` has 200 uncommitted files, look before deleting.
- Screen lock for any on-screen test:
  `( set -o noclobber; echo "<who> $(date -Iseconds)" > /d/dotDock/.claude/screen.lock )`, delete it right after,
  20 minutes at most.
- The Hackatime hook was fixed this session (`9994587`, 50 s CLI cap); check that
  `%LOCALAPPDATA%\dockDock\hackatime-hook.log` shows `exit=0` lines with `ms=`.

# Rules for every agent (2026-11-20 session 2)

Read this, then `CLAUDE.md`, `docs/HANDOFF.md` (your track's row and the owner feedback), and the spec sections
for your track. These rules are not optional.

## Work
- Work **only in your own worktree** (path given in your brief). Never edit `D:\dotDock` main or another track's
  worktree. Never merge into `main`; the lead merges.
- First action: if your worktree has uncommitted work from the last session, review it and commit it as
  `wip(<area>): …` (or discard clearly broken leftovers and say so in the commit message). Then continue.
- **Commit every 30 to 45 minutes**, small Conventional Commits, each one building and testing green. The lead
  checks commits every 30 min; no commit in 60 min gets you pushed, two pushes and you are restarted.
- Speed matters: no long exploration. Read the files you need, decide, build. Log decisions in
  `docs/DECISIONS.md` (next free D-number; on conflict pick the next number after the highest you see) and
  blockers in `docs/BLOCKERS.md`, and carry on with something else. **Never ask the owner questions.**

## Quality bar
- No bugs: typecheck, unit tests, `cargo fmt --check`, `cargo clippy -D warnings` (where Rust is touched) and the
  build must all be green before every commit. Add a test for every bug you fix and every behaviour you add.
- No AI slop: no placeholder text, fake data, TODOs, dead code, unused settings, magic numbers (tokens only),
  generic styling. Every visible control must have a real effect, backed by a test.
- Looks: Nothing-OS-inspired, calm, precise; compare side by side with the reference screenshots in the repo
  (scan recursively) and score with the rubric. Target **≥ 4.8 average**, nothing under 4.5.
- Smooth: 60 fps on interactions, measured with a trace, numbers written into your QA doc.
- **Never gradients**, anywhere, including test harnesses and captures. Default backdrop for tests, demos and
  captures: the green windswept-grass ("Wind Meadow") wallpaper.
- Originals only. Record every new dependency, font, image and sound in `THIRD_PARTY_NOTICES.md`.

## Owner rule (2026-11-21): no bugs because of disk space or interruptions
- Low disk or an interrupted session is never a reason to skip a test, skip a build, ship a wip, or leave a
  feature half-wired. If space runs low, stop building, log it in `docs/BLOCKERS.md` and tell the lead; the lead
  frees space. After any interruption, rebuild and rerun the full checks before your next commit.
- Nothing is deployed or released until the app is exactly as decided in the specs and the owner's feedback.

## Owner rule (2026-11-21): smooth like Linux, no bloat
- The environment must feel light and instant. No background polling where an OS event exists, no timers running
  for hidden UI, no extra processes or services, no heavy dependencies for small jobs, nothing that runs before it
  is needed.
- Every track measures and records idle CPU (target under 0.2 % per process), wake-ups, cold and warm start,
  and 60 fps with 0 dropped frames on every interaction. Regressions are bugs.
- The dock and its catalogue show only apps that really work for this user (no dead shortcuts, uninstallers,
  readmes, help links or duplicates).

## Safety
- Stay inside `D:\dotDock`, `%APPDATA%\dockDock`, `%LOCALAPPDATA%\dockDock` and the listed HKCU keys.
  Never HKLM, never reboot/sign out/shut down, never touch `~/.claude/settings.json`.
- Keep build output on D:. **Disk is tight (about 28 GB free).** Before any cargo build, check free space; if under
  12 GB, stop building and log a blocker. Delete your own stale build output when you no longer need it.
- Only the dock-host track may hide or replace the Windows taskbar, through the D0 safety path, and must restore it
  and set auto-hide back ON afterwards.

## Live, visible testing (owner watches)
- Anything that shows on the desktop (dock, notch, theme, settings, website in a browser) is tested live at a
  human pace, with screenshots in `docs/QA/<track>-live/`.
- **One track on screen at a time.** Before a live run, create `D:\dotDock\.claude\screen.lock` containing your
  track name and the time; if it exists and is under 20 minutes old, wait and do other work. Delete it when done.
  A run holds the screen for at most 20 minutes.

## Finish
- Your track is done only after the double-check protocol: build, self-verify, reviewer A, visual QA + perf, fresh
  reviewer B (start reviewers with `model: "opus"`). Write the result into your QA doc.
- Final message to the lead: branch, HEAD sha, test counts, rubric scores, what is left, anything risky. Short.

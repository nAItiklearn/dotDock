# Notch hard test (soak), 2026-11-21

Live on the real desktop over Wind Meadow (`assets/wallpapers/meadow-dots-dark.jpg`), 1920x1080 at 125 %, debug
core with the **production** frontend (`vite preview`), while other tracks' agents loaded the machine (about 55 %
CPU). Run: `bash tools/capture/island-soak-run.sh` (SECS=180, SEED=1). Raw numbers in `soak/`.

## What the soak does
`tools/capture/island-soak.mjs`: a child process writes every phase (thinking .. running, waiting, done, paused,
limit, error, token updates) for four sessions every 0.18 to 1.6 s; at the same time the real cursor
(`tools/capture/input.ps1`) hovers, flicks across, clicks, right-clicks (dismiss), swipes sideways, clicks pager
dots and gives focus to another window, 0.25 to 1.1 s apart. The page is probed four times a second and every
frame is timed. At the end the child is killed (a crashed agent).

## Result of the 180 s run (seed 1)
| Check | Result |
|---|---|
| Actions | 162: hover 15, leave 16, flick 19, click 17, right-click 19, swipe 23, pager 16, focus loss 22, rest 15 |
| Console errors | 0 (after fix 1; the first trial runs logged a `/favicon.ico` 404) |
| Frames | 10 800 at 60 Hz, median 16.7 ms, p99 17.0 ms, **3 dropped** (worst 99.8 ms) |
| Baseline / idle frames | 602 frames, 0 dropped, both before and after the soak |
| Standby after the crash | 11.6 s (all sessions Stopped, then folded to the 44x12 pill) |
| Idle CPU, 60 s, per process | dotdock 0.061 %, WebView2 processes 0 to 0.093 % (all under 0.2 %; tree total 0.26 %) |
| Stuck states | 6 probes flagged "stuck aside": a **driver** error, not the island (see below) |

Screenshots: `soak/soak-0001.png` .. `soak-0029.png` (every 36 s), `soak/soak-after-standby.png`.

## Bugs found and fixed
1. **Favicon 404 on every start** (`b2f2ca7`): the page now declares an inline icon; test `src/island/page.test.ts`.
2. **First expansion 55 ms, two dropped frames** (`d93163e`): a trace put about 20 ms into building a locale number
   formatter, and counts of 10 000 or more built one on every animated frame. Formatters are cached and built at
   start; test in `src/island/format.test.ts` (fails on the old code).
3. **Live harness measured development React** (`8eee759`): every earlier frame number came from vite's dev
   server (StrictMode, about 20 ms per snapshot render, 18 drops in 40 s). The harness serves the production build
   by default now; the same 40 s trial dropped 2 frames instead of 18.

The "stuck aside" flags were the soak's own mistake: it clicked pager dots read while the island had slid away
(y = -18 px), Windows kept the cursor at the screen's top edge, which is inside the hover footprint, so the island
was right to stay aside. The driver now reads where the cursor really is and only clicks the pager when it is on
screen. That driver fix was not re-run: the owner stopped testing (done is done) before the screen was free again.

## Known, not fixed
- **3 dropped frames in 180 s** remain: 33 + 50 ms on the very first expansion of the run (first mount of the
  active island) and one 99.8 ms frame during a right-click dismiss. Their cause is not attributed yet; the soak
  now records long animation frames with their scripts for the next run. Spec target is 0 dropped.
- Monitor and DPI change were not soaked: there is one monitor, and changing the display scale is a system setting
  outside this track's scope.

## Rubric (self-score, side by side with `1747058098-...-ss7-thumb.webp` status pill and `00-nthing-002-10.jpg`)
Visual rubric (12.3): fidelity 4.7, typography and dot-matrix craft 4.8, spacing 4.8, colour and contrast 4.7,
motion 4.6 (smooth springs, but the drops above), state completeness 4.9, consistency 4.7, originality 4.9.
Average **4.76**.

Owner's four axes: design 4.8, performance 4.5 (idle CPU met, 3 drops in 180 s against a target of 0), accuracy
4.8 (every phase and the crash shown correctly, 0 errors), functionality 4.8. Average **4.7**: performance holds it
under 4.8 until the remaining drops are attributed and gone.

## Verify
```
cd apps/desktop && npx tsc --noEmit && npx vitest run && npx vite build
cd src-tauri && source ../../../tools/env-gnu.sh && cargo +stable-x86_64-pc-windows-gnu fmt --all --check \
  && cargo +stable-x86_64-pc-windows-gnu clippy --workspace --all-targets -- -D warnings \
  && cargo +stable-x86_64-pc-windows-gnu test --workspace
# live (needs the screen lock free and no other dotdock.exe): source tools/capture/island-live.sh; build_app
bash tools/capture/island-soak-run.sh      # writes docs/QA/notch-live/soak/report.json, exit 0 only on a pass
```

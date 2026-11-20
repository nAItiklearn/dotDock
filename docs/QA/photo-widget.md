# QA: photo widget, finishing pass (2026-11-21)

Follows `docs/QA/photo-frames.md` (sizes, borders, shapes; scored 4.79 by its maker). This pass is the visual QA over real wallpapers, a frame-time trace, the fresh reviewer B and the rescore. Code: `apps/desktop/src/widgets/photo/`. Decision: `docs/DECISIONS.md` D-025.

## Build and self-verify
- `tsc --noEmit` is clean. `vitest run` passes 759 tests in 44 files (752 before this pass).
- New tests:
  - `look.test.ts`: the pill ring lies on the pill, has an even count, and is symmetric on both axes when the widget is wide, tall or square. `stadiumPoints` spaces points evenly within 3 %, gives a true circle when the sides match, and stands upright when tall. `stadiumPerimeter` is checked. `lookVars` gives a pill fully round ends.
  - `decode.test.ts`: a cache refuses requests after `dispose`. `drawCopy` hands the canvas a clone it owns, clones nothing for a request dropped during decode, and closes its clone when the request is dropped while cloning or the canvas is gone.
- No Rust was touched.

## Visual QA over real wallpapers
- **Tool:** `tools/capture/photo-qa.mjs`, headless Chrome over CDP at 1.5x. Run it from the repository root: `node tools/capture/photo-qa.mjs http://127.0.0.1:<port>/src/widgets/gallery/index.html <out> shots`. It shows the gallery with `?wallpaper=`, which puts a real desktop picture behind the widgets.
- **Wallpapers (7, full 3840 x 2160):** Wind Meadow dark and light (the green grass), Screen Ridge dark, Paper Ring light, Red Waves dark, Glass Orbs light and Topo Lines dark.
- **Photos:** only originals from this repository's art engine (Lattice Bloom light and Reeded Violet dark). No public figures and no owner photos are used.
- **What each wallpaper got:** all 8 sizes, three sheets per wallpaper (compact: S, Medium, Tall; wide: Wide, Landscape, Portrait; large: Large, Panorama). Each sheet shows every border (edge to edge, keyline, mat, polaroid, dots), all three shapes (rounded, squircle, circle or pill), square ink mat, accent keyline, mono ink polaroid, and grey and accent polaroids. The settings panel was also captured in Obsidian and Paper.
- **Output:** 23 sheets in `.cache/photo-qa/shots3/` (git-ignored, 2 to 3 MB each). Reduced copies are in `docs/QA/photo-live/sheets/`.

Findings and what was done:
| Finding | Fix |
|---|---|
| The circle shape became an ellipse on non-square sizes; 4x3 and 3x4 read as eggs, and the reference desktop (`1747058098-43375-ss7-thumb.webp`) uses a pill | The circle is now a pill: round ends of half the short side, a true circle on square sizes, and a dot ring spaced evenly along the pill (D-025, commit e271d42) |
| Borderless (edge to edge) must not have a dotted ring | Confirmed on every sheet and in the live run (`photo-live/04-borderless-done-no-ring.png`); only the dot-matrix border draws dots |
| Mat and polaroid bands of the same lightness as the desktop (paper on Wind Meadow light, ink on Red Waves dark) | Readable: the band's hairline edge (`--photo-edge-mix`) outlines it on every wallpaper |
| Captions on grey and accent polaroids over grass and red | Readable; the ink is chosen per border colour to at least 4.5 : 1 (`ink.test.ts`) |
| The gallery's case labels could not be read over busy wallpapers | Harness only: the labels sit on a surface plate when `?wallpaper=` is set |
| The polaroid captions in the gallery referred to the owner's cake photo | Harness only: replaced with neutral captions |

## Performance
- **Bench:** `?perf=` in the gallery (`perfBench.tsx`) runs one dot-matrix photo widget for three 4 s runs in a row:
  - It cycles through all eight sizes, one size change every 6 frames. The first run decodes each copy for the first time; the second runs with the copies already cached.
  - It swaps between four 3840 x 2160 JPEGs, one replace every 30 frames.
- **Measurement:** frame intervals come from requestAnimationFrame. Main-thread blocking comes from Long Animation Frames (`blockingDuration`).
- **Where:** headful Chrome with the GPU (the chrome-devtools browser), Wind Meadow behind the widget, 60 Hz display.

| Run (after reviewer B fixes, DPR 1) | Frames | Median | p95 | p99 | Max | Frames over 20 ms |
|---|---|---|---|---|---|---|
| Resize, first cycle (new decodes) | 240 | 16.7 ms | 16.8 ms | 17.0 ms | 17.3 ms | 0 |
| Resize, warm cache | 239 | 16.7 ms | 16.8 ms | 17.0 ms | 17.6 ms | 0 |
| Photo swap (4 photos, 8 replaces) | 237 | 16.7 ms | 16.8 ms | 17.3 ms | 49.7 ms | 1 |

| Run (before the fixes, emulated 2x) | Frames | Median | p95 | p99 | Max | Frames over 20 ms |
|---|---|---|---|---|---|---|
| Resize, first cycle | 237 | 16.7 ms | 16.8 ms | 33.3 ms | 33.4 ms | 3 |
| Resize, warm | 237 | 16.7 ms | 16.8 ms | 17.2 ms | 33.4 ms | 2 |
| Photo swap | 238 | 16.7 ms | 16.8 ms | 17.3 ms | 33.3 ms | 1 |

- **Main thread:** the longest blocking time of any long frame in every run was 0 to 1 ms. Decoding and downsampling run in `createImageBitmap` off the main thread, and the old copy stays up until the new one is ready.
- **The previous QA's hitch:** it reported 130 to 165 ms per new decode scale. That is gone: the first-cycle resize no longer drops frames.
- **Headless runs:** without a GPU (software raster), the first cycle shows 0.5 to 1 s presentation gaps. Their long frames have 0 ms of script and 0 ms of blocking, so the time is in software rasterising and uploading the copies, not in the widget. These are not representative of WebView2 on a GPU and are not used for the verdict.
- **Replacing a photo:** the new canvas fades in once its first copy has decoded, about 6 frames for a 3840 x 2160 JPEG. Over 8 replaces, 47 frames had no picture drawn. Before reviewer B's fix, the blank lasted through the IndexedDB read as well.

## Reviewer B (fresh context, Opus)
It found 13 items. Fixed in e4b9d01:
1. **High:** a replace mounted an empty canvas, and nothing drew into it until the new file loaded. A resize in that gap could decode into a cache that was already disposed.
   - Now the old photo and its copies stay until the new one is read. The canvas is keyed per load, and a disposed cache refuses requests (`CacheDisposedError`, ignored).
   - `drawCopy` closes stale clones and is tested.
2. **Medium:** a DPI change did not re-bucket. A `matchMedia` resolution hook now follows the device pixel ratio.
3. **Medium:** wheel zoom started a full decode at almost every notch. Buckets now follow the saved framing, and during a gesture the compositor scales the current copy.
5. A decode problem stayed after a later copy drew. It now clears.
6. A clone was made after cleanup. `drawCopy` now checks that the request is still live before cloning.
8. A pending zoom save could land on a new file. The timer and draft are now cleared when the file changes.
9. Escape and Enter leaked to the overlay. They now stop at the widget, and focus returns to the Adjust button.
10. RTL captions now use `dir="auto"`.
12. `imageOrientation: "from-image"` is now explicit.

Open, low:
- **4:** there is no DOM test of the component itself. The project has no jsdom; the async drawing logic was moved into `drawCopy` and is tested there.
- **7:** sizes are measured in whole px. At fractional DPI the dots can sit up to 0.5 px off.
- **11:** caption ink assumes opaque border colours. Every built-in token is opaque.
- **13:** cf215c0 is typed `wip`, as `AGENT_RULES.md` asks for leftovers.

Reviewer B's own scores, before the fixes: correctness 3.5, performance 4.5, code quality 4.5, tests 3.5. The correctness and test findings behind the two 3.5s are the ones fixed above.

## Rubric (MASTER_SPEC 12.3), rescored side by side with the references
I compared with `1747058098-43375-ss7-thumb.webp` (a pill photo with a dark keyline beside pill and round widgets) and the other root reference desktops.

| Dimension | Score | Why |
|---|---|---|
| Fidelity to the reference mood | 4.9 | The pill photo now matches the reference silhouette. Keyline, mat, polaroid with mono caps and the dot ring all read as Nothing-calm over grass, red, paper and dark art. |
| Typography and dot-matrix craft | 4.9 | Whole-cell rings on rectangles. Evenly spaced, symmetric rings on pills and circles. Mono caps captions. |
| Spacing and rhythm on the grid | 4.8 | Eight whole-cell footprints. Bands are capped so the photo keeps half the widget. Window corners are concentric, and round ends are true half circles. |
| Colour and contrast, light and dark | 4.8 | Caption ink is at least 4.5 : 1 on every border colour and theme. Bands keep an edge on a desktop of the same lightness, checked on seven wallpapers. |
| Motion quality | 4.8 | Border geometry eases over `--dur-med`, and a resize snaps. 0 dropped frames while resizing through every size. A replace fades in after about 100 ms. |
| State completeness | 4.8 | Empty, dropping, adjusting, problem (now clears on recovery), loading and loaded, in every size. |
| Consistency with siblings | 4.8 | Same Surface, tokens, panel and controls as the other widgets. The pill matches the date, battery and music pills. |
| Originality | 4.8 | Own geometry (arc-length dot rings on pills) and own art; nothing copied. |

**Average 4.83, lowest 4.8.** That meets the bar (average at least 4.8, nothing under 4.5).

## Live run
- **Setup:** screen lock taken as `photo`, then `overlay.html` opened in the visible Chrome window. The overlay's wallpaper is the real desktop in the app; the browser shows its dark backdrop instead.
- **Steps:** entered edit mode (Ctrl+Alt+E), added a Wide photo from the drawer, and gave it Reeded Violet. Then set Dot matrix, Circle or pill and Accent, and resized to Portrait from the panel. Finally set Edge to edge and pressed Done. The widget followed each change at once.
- **Screenshots:** `docs/QA/photo-live/01` to `04`. The lock was released after the run.
- **Not run:** the Tauri build (CI only, no local MSVC), dropping a real file from Explorer, and mixed-DPI monitors.

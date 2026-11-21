# QA: photo widget sizes, borders and shapes

Decision and reasoning: `docs/DECISIONS.md` D-015 (update of 2026-11-20). Code: `apps/desktop/src/widgets/photo/` (`look.ts` geometry, `config.ts` sizes and settings, `PhotoWidget.tsx`, `PhotoWidget.css`).

## Build and self-verify
- `pnpm typecheck` clean. `pnpm test`: 736 passed in 42 files (658 before this work).
- New tests: `look.test.ts` (band capping, polaroid foot, dot ring tiling, symmetry, rounded-corner clipping, even spacing on an ellipse, stylesheet variables), `config.test.ts` (saved-settings migration, repair of hand-edited values, defaults equal to `tokens.css`, which fields the panel shows, footprints saved layouts hold, the corner-handle ladder), `frame.test.ts` (the photo covers its window at all eight footprints for any framing and keeps its proportions, the focal point survives a resize, damaged framing falls back to centred), `store.test.ts` (framing saved per placement id and restored in the next window, clamped on the way in, damaged entries repaired on load), `configSchema.test.ts` (`appliesWhen`, `replaces`), and a registry check that every `appliesWhen` names a real field and value.
- Run in the real edit mode (`overlay.html` in a browser, Ctrl+Alt+E): added a Photo from the drawer, changed Border to Polaroid, typed a caption, switched Size to Medium from the new size list. The widget followed each change at once (`shots/09-overlay-polaroid-medium.png`).
- Not run here: the Tauri build (CI), a real photo dropped from Explorer, a multi-monitor mixed-DPI layout.

## Performance (Chromium, 2x device scale, 4 photo widgets with a 6000 x 4000 JPEG each)
| Case | Median | p95 | Max |
|---|---|---|---|
| 1 widget, size changed every frame (after the first cycle) | 16.7 ms | 16.8 ms | 17.1 ms |
| 4 widgets, size changed every 120 ms (a drag across presets) | 16.7 ms | 16.8 ms | 17.5 ms |
| 1 widget, size changed every 60 ms | 16.7 ms | 16.8 ms | 17.6 ms |
| 4 widgets at once, size changed every frame (synthetic stress) | 16.7 ms | 33.4 ms | 49.9 ms |

- The first time a 24 MP photo is shown at a new decode scale the browser spends about 130 to 165 ms once (three such frames in the first cycle, none after). A resize is a snap between whole-cell footprints, so this is one hitch per scale per photo, not a drop while dragging. Smaller photos cost proportionally less. Not fixed: pre-decoding at every scale would hold several copies of the photo.
- The image is laid out at its final pixel size (`width`, `height` in px, a `translate` for position). Nothing scales it.

## Screenshots
All in `.cache/qa/shots/` (git-ignored; the owner's cake photo is in several of them):
- `01-medium-all-styles.png`, `02-medium-hires.png`: every border and shape at 3x3 (edge to edge, keyline, mat, polaroid, dots, squircle, circle, circle dots, circle mat, ink mat, accent keyline, ink polaroid in mono).
- `03-sizes-obsidian.png`: Small, Wide, Tall and Portrait with mat, polaroid, dots and circle dots. `12-landscape-panorama.png`: Landscape and Panorama. `10-large-aurum.png`: Large in Aurum.
- `04-settings-panel.png`: the real settings form beside the widget for edge to edge, polaroid and a circular dot border.
- `05-empty-paper.png`: the empty state in the Paper theme in every window size. `06-adjusting-polaroid.png`: adjust mode in a polaroid. `07-medium-paper.png`, `11-dots-paper-shadow.png`: the Paper theme.
- `08-overlay-edit.png`, `09-overlay-polaroid-medium.png`: the real overlay and drawer.

## Contrast
| Pair | Obsidian | Paper | Aurum |
|---|---|---|---|
| Paper border against its caption ink | 16.15 | 16.15 | 16.15 |
| Grey border against its caption ink | 5.45 | 4.35 | 7.58 |
| Accent border against its caption ink | 4.8 | 4.34 | 9.79 |
| Paper border against the theme background | 16.15 | 1.07 | 16.73 |
| Ink border against the theme background | 1.00 | 15.16 | 1.04 |

A paper border on the Paper theme and an ink border on a dark theme sit on a background of the same lightness. That is the user's choice and the picture still defines the widget, but a light mat on a light desktop is a soft edge, not a strong one. The dot-matrix ring has a soft shadow so light dots on a light theme stay readable. The grey and accent captions on the Paper theme are 0.15 short of 4.5 : 1 (10 px mono caps).

## Rubric (MASTER_SPEC 12.3, applied to the sizes, borders and shapes)
| Dimension | Score | Why |
|---|---|---|
| Fidelity to the reference mood | 4.8 | A hairline keyline, a polaroid with mono caps, and a ring of dots that tiles each side in whole cells; square, rounded, squircle and circle silhouettes; tokens only. |
| Typography and dot-matrix craft | 4.9 | The ring has whole cells on every side, drops the corner dots a rounded corner would cut, and spaces dots evenly by arc length on a circle or oval (tested to 3 %). Captions are the project's mono caps. |
| Spacing and rhythm on the grid | 4.8 | Eight whole-cell footprints; widths and radii on the 4 px token grid; the photo keeps half the widget on each axis; the window corner is concentric with the widget's but never rounder than a soft corner. |
| Colour and contrast, light and dark | 4.7 | Four token colours, caption ink chosen per colour (16 : 1 on paper and ink). Two Paper-theme captions are just under 4.5 : 1, and same-lightness borders are soft (above). |
| Motion quality | 4.7 | Shape, colour and shadow ease over `--dur-med`; ring and caption fade in; all of it off under reduced motion. The border geometry itself changes at once and a 24 MP photo hitches once per decode scale. |
| State completeness | 4.8 | Empty, dropping, adjusting, problem and loaded states in every window size; the empty state drops its pictogram and sentence as the window shrinks and keeps its button on one line. |
| Consistency with siblings | 4.8 | Same Surface, tokens, controls and panel as the other widgets; the new swatches, size list and conditional fields are generic and available to any widget. |
| Originality | 4.8 | No copied layout or asset; the dot ring and the arc-length spacing are this project's own. |

Average 4.79 (4.8 rounded); lowest 4.7. The score is the maker's; no one else has rated it.

## Best with the owner's cake photo (for the website)
1. **Circle with a dot-matrix ring in the accent colour** (Large or Medium, any theme; gold in Aurum is the best of the three). The cake is round, so the ring echoes it, and it is the most Nothing-flavoured style.
2. **Polaroid with a typed caption** (Medium or Large, paper on a dark theme). Warm and personal; the caption in mono caps carries the story.
A paper mat is the quiet third choice.

## Open
- Reviewer B (fresh context) has not run on this change.
- Dots in the default paper colour on a light desktop need the user to pick another colour for strong contrast.

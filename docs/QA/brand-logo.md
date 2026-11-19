# QA: logo and icon set

Decision and reasoning: `docs/DECISIONS.md` D-019. Usage: `brand/README.md`. Generator: `tools/brand-gen`.

## Build and self-verify
- `python -I tools/brand-gen/build.py` writes 23 files; running it twice gives the same SVGs.
- `icon.ico` decodes to nine entries (16, 20, 24, 32, 40, 48, 64, 128, 256). The 16 px entry was read back and checked pixel by pixel: dot columns 2 to 9, one clear column, pill columns 11 to 13, no stray anti-aliasing except the pill's round ends.
- Every SVG in `brand/` and `website/public/favicon.svg` renders in resvg; the wordmark has no text elements (94 dots plus the mark's dot, all circles), so it renders without fonts.
- `website`: `pnpm build` passes (notices sync, contrast check 4.5:1 on every theme, `astro check` 0 errors, 5 pages built).
- `apps/desktop`: `pnpm typecheck` passes.
- `src-tauri`: `cargo check` passes on the local GNU toolchain after the `tray.rs` change.
- Not run here: an MSVC build and the installer (CI does those), and a visual check of the tray on a real taskbar at 125% and 200% scale. The tray asks the `.ico` for `SM_CXSMICON`, which the 16, 20, 24 and 32 px drawings cover.

## Visual QA
Sheets (all in `brand/exploration/`, plus `.cache/brand/` when generated locally):
- `round1-a.png`, `round1-b.png`: ten concepts at 256, 64, 32, 16 px on dark, light, Aurum gold and one colour, 16 px enlarged.
- `round2.png` to `round4.png`: variations on the docked `d`.
- `final.png`: the shipped mark on a dark taskbar, a light taskbar, Aurum and gold.
- Website nav in Obsidian, Paper and Aurum: screenshot taken with `pnpm preview` on port 4399; the dot takes each theme's accent and the pill the text colour.

## Contrast (WCAG graphics threshold 3:1)
| Pair | Ratio |
|---|---|
| Red dot on charcoal tile | 4.80 |
| Ivory pill on charcoal tile | 15.16 |
| Paper red dot on paper tile | 3.49 |
| Gold dot on Aurum black | 10.14 |
| Charcoal on gold (one colour) | 9.79 |
| Charcoal tile on a dark taskbar (#202020) | 1.16 |
| Red dot on a dark taskbar | 4.14 |

The tile alone does not separate from a dark taskbar. The dot and the pill do, and a hairline marks the tile edge from 48 px up.

## Rubric (MASTER_SPEC 12.3, brand applied to the logo set)
| Dimension | Score | Why |
|---|---|---|
| Fidelity to the reference mood | 4.7 | Charcoal, ivory, one red; circle and pill only, the shapes the references use. |
| Typography and dot-matrix craft | 4.6 | Wordmark is Doto cut to 94 circles on the font's lattice; the mark is the `d` with its dots fused. The mark itself is flat, not dotted: the dots live in the wordmark and the lattice. |
| Spacing and rhythm on the grid | 4.8 | 4 unit lattice on a 96 unit tile; lockup mark and letters share top and bottom; clear space is one dot radius. |
| Colour and contrast, light and dark | 4.5 | Every pair above 3:1; the dark tile on a dark taskbar is weak (1.16) and handled by the hairline and the dot. |
| Motion quality | 4.5 | Website nav: the dot slides into its socket once, `--dur-slow`, none under reduce-motion. The desktop app has no logo motion yet. |
| State completeness | 4.6 | 16 to 512 px, light, dark, Aurum, one colour, redrawn small sizes, tray size, favicon, apple-touch, social card. No animated or monochrome tray variant. |
| Consistency with siblings | 4.7 | Theme accent drives the dot; same Doto face as the website wordmark; same tokens as the widgets. |
| Originality | 4.6 | A dot docked in a socket cut from a pill; no dot-matrix letter mark, no segmented ring, no Nothing glyphs or Ndot. |

Average 4.62; lowest 4.5. Passes the bar. The score is the maker's; the mark has not been tested with real viewers.

## Open
- Reviewer B (fresh context) has not run on this change.
- The website footer still shows the name as large Doto text without the mark; the mark could join it.

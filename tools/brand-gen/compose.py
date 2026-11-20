"""SVG builders for every brand asset, drawn from the one mark in `mark.py`."""
from __future__ import annotations

import re
from pathlib import Path

from PIL import Image

from mark import MASTER, PIXEL_SIZES, Spec, bowl_path, bowl_svg, stem_path, stem_svg
from svgkit import AURUM, OBSIDIAN, ON_GOLD, PAPER, Palette, raster
from typeset import DOTO_PITCH, DotText, doto_dots, shaped_path

ROOT = Path(__file__).resolve().parents[2]

PALETTES = {p.name: p for p in (OBSIDIAN, PAPER, AURUM, ON_GOLD)}

# The hairline that keeps the dark tile visible on a dark taskbar. Too faint to survive below 48 px.
HAIRLINE_OPACITY = 0.1
HAIRLINE_MIN_BOX = 48
# The clear space between the mark and the wordmark, in dots of the wordmark's lattice.
LOCKUP_GAP_DOTS = 3


def product_name() -> str:
    """The name is set once, in apps/desktop/src/lib/branding.ts."""
    text = (ROOT / "apps" / "desktop" / "src" / "lib" / "branding.ts").read_text(encoding="utf-8")
    match = re.search(r'export const PRODUCT_NAME = "([^"]+)"', text)
    if not match:
        raise RuntimeError("PRODUCT_NAME not found in branding.ts")
    return match.group(1)


def _num(v: float) -> str:
    text = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def document(inner: str, view_box: str, label: str, extra: str = "") -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}" role="img" aria-label="{label}"{extra}>'
            f"<title>{label}</title>{inner}</svg>\n")


def glyph(spec: Spec, bowl_fill: str, stem_fill: str) -> str:
    return bowl_svg(spec, bowl_fill) + stem_svg(spec, stem_fill)


def tile(spec: Spec, pal: Palette, *, hairline: bool | None = None) -> str:
    """The app tile: a rounded square with the glyph on it."""
    if hairline is None:
        hairline = spec.box >= HAIRLINE_MIN_BOX and pal.tile == OBSIDIAN.tile
    rect = f'<rect width="{_num(spec.box)}" height="{_num(spec.box)}" rx="{_num(spec.tile_radius)}" fill="{pal.tile}"/>'
    if hairline:
        inset = spec.box / 192  # half a stroke, so the line sits inside the edge
        rect += (f'<rect x="{_num(inset)}" y="{_num(inset)}" width="{_num(spec.box - 2 * inset)}" height="{_num(spec.box - 2 * inset)}" '
                 f'rx="{_num(spec.tile_radius - inset)}" fill="none" stroke="{pal.ink}" stroke-opacity="{HAIRLINE_OPACITY}" '
                 f'stroke-width="{_num(spec.box / 96)}"/>')
    return rect + glyph(spec, pal.accent, pal.ink)


def tile_svg(spec: Spec, pal: Palette) -> str:
    label = product_name()
    return document(tile(spec, pal), f"0 0 {_num(spec.box)} {_num(spec.box)}", label)


def tile_png(px: int, pal: Palette = OBSIDIAN) -> Image.Image:
    """The app tile at `px`: the hand-tuned drawing where one exists, else the master scaled."""
    return raster(tile_svg(PIXEL_SIZES.get(px, MASTER), pal), px)


def mono_svg(spec: Spec = MASTER) -> str:
    """One path, one colour (currentColor). The gap is real space, so it needs no second colour."""
    left, top, right, bottom = spec.extent
    d = bowl_path(spec) + stem_path(spec)
    view = f"{_num(left)} {_num(top)} {_num(right - left)} {_num(bottom - top)}"
    return document(f'<path d="{d}" fill="currentColor"/>', view, product_name())


def lockup(pal: Palette, *, mono: bool = False) -> tuple[str, float, float]:
    """Mark and name side by side. The mark is as tall as the letters, its stem level with the ascender dots.

    Returns the inner markup plus the width and height of the artwork in the wordmark's font units.
    """
    text: DotText = doto_dots(product_name())
    k = text.height / MASTER.stem_h
    left, top, right, _ = MASTER.extent
    mark_w = (right - left) * k
    x0 = mark_w + LOCKUP_GAP_DOTS * DOTO_PITCH
    ink = "currentColor" if mono else pal.ink
    bowl = "currentColor" if mono else pal.accent
    mark = (f'<g transform="translate({_num(-left * k)} {_num(-top * k)}) scale({_num(k)})">'
            f"{glyph(MASTER, bowl, ink)}</g>")
    dots = "".join(f'<circle cx="{_num(x0 + d.cx)}" cy="{_num(d.cy)}" r="{_num(d.r)}"/>' for d in text.dots)
    return f'{mark}<g fill="{ink}">{dots}</g>', x0 + text.width, text.height


def lockup_svg(pal: Palette) -> str:
    inner, w, h = lockup(pal)
    return document(inner, f"0 0 {_num(w)} {_num(h)}", product_name())


def favicon_svg() -> str:
    """The 16 px drawing, which is the one that must be crisp in a tab. Light and dark come from the browser."""
    spec = PIXEL_SIZES[16]
    style = (
        "<style>"
        f".tile{{fill:{OBSIDIAN.tile}}}.stem{{fill:{OBSIDIAN.ink}}}.dot{{fill:{OBSIDIAN.accent}}}"
        "@media (prefers-color-scheme: light){"
        f".tile{{fill:{PAPER.tile}}}.stem{{fill:{PAPER.ink}}}.dot{{fill:{PAPER.accent}}}"
        "}</style>"
    )
    rect = f'<rect class="tile" width="16" height="16" rx="{_num(spec.tile_radius)}"/>'
    body = bowl_svg(spec, extra=' class="dot"') + stem_svg(spec, extra=' class="stem"')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">{style}{rect}{body}</svg>\n'


def astro_mark_component() -> str:
    """The glyph as an Astro component whose colours follow the site theme (accent dot, text pill)."""
    left, top, right, bottom = MASTER.extent
    view = f"{_num(left)} {_num(top)} {_num(right - left)} {_num(bottom - top)}"
    return f"""---
// Generated by tools/brand-gen/build.py from the master geometry. Edit the generator, not this file.
interface Props {{
  /** Height in px; the width follows the mark's proportions. */
  size?: number;
  class?: string;
}}
const {{ size = 28, class: className }} = Astro.props;
const width = Math.round((size * {_num(right - left)}) / {_num(bottom - top)});
---

<svg class:list={{["mark", className]}} xmlns="http://www.w3.org/2000/svg" viewBox="{view}" width={{width}} height={{size}} aria-hidden="true" focusable="false">
  {bowl_svg(MASTER, extra=' class="mark__dot"')}
  {stem_svg(MASTER, extra=' class="mark__stem"')}
</svg>

<style>
  .mark {{
    display: block;
    flex: none;
    overflow: visible;
  }}
  /* The dot docks: it slides in from the left and settles into its socket. */
  .mark__stem {{
    fill: var(--text);
  }}
  .mark__dot {{
    fill: var(--accent);
    animation: mark-dock var(--dur-slow) var(--ease-out) both;
  }}
  @keyframes mark-dock {{
    from {{
      transform: translateX(-24px);
      opacity: 0;
    }}
    to {{
      transform: none;
      opacity: 1;
    }}
  }}
</style>
"""

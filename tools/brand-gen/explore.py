"""The logo exploration for the dotDock mark.

Round 1 is ten different ideas. Round 2 takes the strongest (a dot docked in a pill, which reads as
a 'd') through six variations, round 3 tests dot-matrix details on it, and round 4 tunes its
proportions. Every concept is built from a dot, a pill and a lattice of dots on a 100 unit box.

    python -I tools/brand-gen/explore.py --out brand/exploration

writes the concept SVGs and contact sheets showing each at 256, 64, 32 and 16 px on dark, light,
Aurum gold and one colour, plus the 16 px pixels enlarged. The final mark (mark.py) is drawn on a
96 unit lattice after these sheets; it is the "B socket" idea with the round 4 proportions.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path
from typing import Callable

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from svgkit import (  # noqa: E402
    ACCENT, AURUM, DIM, INK, OBSIDIAN, ON_GOLD, PAPER, TILE, Palette, Scene, capsule, circle, raster, raster_size, to_svg,
)

TILE_RADIUS = 23.0


def dock_grid() -> Scene:
    """Apps over a dock: two rows of dots resting on a pill."""
    s = Scene()
    for y in (27, 49):
        for x in (26, 50, 74):
            s.circle(x, y, 8, ACCENT if (x, y) == (50, 49) else INK)
    s.capsule(19, 64, 62, 15)
    return s


def drop() -> Scene:
    """A dot falling into a slot, leaving a trail."""
    s = Scene()
    s.circle(50, 17, 3.5, DIM)
    s.circle(50, 31, 5.5, DIM)
    s.circle(50, 51, 12, ACCENT)
    s.capsule(18, 70, 64, 13)
    return s


def fisheye() -> Scene:
    """A row of dots that swell toward the middle, like a magnified dock."""
    s = Scene()
    for x, y, r, role in ((14, 58, 4.5, INK), (31, 53, 7, INK), (50, 46, 12, ACCENT), (69, 53, 7, INK), (86, 58, 4.5, INK)):
        s.circle(x, y, r, role)
    return s


def docked_d() -> Scene:
    """A dot nested in a notch of a tall pill: reads as a 'd'."""
    s = Scene()
    gap = 5.0
    bowl = circle(43, 62, 24, ACCENT)
    stem = capsule(64, 14, 17, 74, INK)
    s.cut(stem, (circle(43, 62, 24 + gap, INK),), "notch")
    s.items.append(bowl)
    return s


def orbit() -> Scene:
    """A dot with a smaller one on an orbit ring."""
    s = Scene()
    s.circle(50, 50, 33, INK).circle(50, 50, 33 - 7, TILE)
    s.circle(50, 50, 14, INK)
    s.circle(50 + 33 * math.cos(math.radians(-45)), 50 + 33 * math.sin(math.radians(-45)), 9, ACCENT)
    return s


def cradle() -> Scene:
    """A dot about to settle into a U-shaped cradle."""
    s = Scene()
    s.path("M21 44 V52 A29 29 0 0 0 79 52 V44", INK, stroke=13)
    s.circle(50, 38, 12, ACCENT)
    return s


def lift() -> Scene:
    """A row of dots with one raised: a dock icon on hover."""
    s = Scene()
    for i, x in enumerate((17, 39, 61, 83)):
        raised = i == 2
        s.circle(x, 42 if raised else 66, 9, ACCENT if raised else INK)
    return s


def hex_cluster() -> Scene:
    """Seven dots packed in a hexagon, one red in the middle."""
    s = Scene()
    for k in range(6):
        a = math.radians(60 * k)
        s.circle(50 + 25 * math.cos(a), 50 + 25 * math.sin(a), 11.5, INK)
    s.circle(50, 50, 11.5, ACCENT)
    return s


def d_tile() -> Scene:
    """A D-shaped silhouette with a 2 x 2 lattice punched out, one dot red."""
    s = Scene()
    s.path("M26 14 H50 A36 36 0 0 1 50 86 H26 A12 12 0 0 1 14 74 V26 A12 12 0 0 1 26 14 Z", INK)
    for x, y in ((38, 38), (60, 38), (38, 62)):
        s.circle(x, y, 8, TILE)
    s.circle(60, 62, 8, ACCENT)
    return s


def dot_on_dock() -> Scene:
    """A dot seated in a notch on top of a long pill."""
    s = Scene()
    pill = capsule(12, 58, 76, 22, INK)
    s.cut(pill, (circle(50, 46, 24, INK),), "seat")
    s.circle(50, 46, 19, ACCENT)
    return s


CONCEPTS: list[tuple[str, str, Callable[[], Scene]]] = [
    ("01 dock grid", "apps over a dock", dock_grid),
    ("02 drop", "dot falls into slot", drop),
    ("03 fisheye", "magnified dock row", fisheye),
    ("04 docked d", "dot nested in a pill", docked_d),
    ("05 orbit", "ring and moon", orbit),
    ("06 cradle", "dot and a U", cradle),
    ("07 lift", "one dot raised", lift),
    ("08 hex", "seven dot cluster", hex_cluster),
    ("09 D tile", "D silhouette lattice", d_tile),
    ("10 seat", "dot on a long pill", dot_on_dock),
]

CHROME = "#2a2a2a"
LABEL = "#cfcdc9"
FONT = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 13)
PALETTES: list[Palette] = [OBSIDIAN, PAPER, AURUM, ON_GOLD]


def glyph_cell(scene: Scene, pal: Palette, px: int) -> Image.Image:
    """The bare glyph, centred on the palette's page colour."""
    svg = to_svg(scene, pal, page=True)
    return raster(svg, px)


def tile_cell(scene: Scene, pal: Palette, px: int) -> Image.Image:
    """The app tile (rounded square) with the glyph on it."""
    return raster(to_svg(scene, pal, tile_radius=TILE_RADIUS), px)


def paste_row(sheet: Image.Image, y: int, x0: int, images: list[Image.Image], gap: int = 8) -> int:
    x = x0
    for im in images:
        sheet.paste(im, (x, y), im)
        x += im.width + gap
    return y + max(im.height for im in images)


def build_sheet(concepts: list[tuple[str, str, Callable[[], Scene]]], out: Path) -> None:
    col_w, pad = 376, 14
    rows_h = [256 + 2 * pad, 64 + 2 * pad, 32 + 2 * pad, 16 + 2 * pad, 128 + 2 * pad]
    head = 46
    sheet = Image.new("RGBA", (col_w * len(concepts), head + sum(rows_h)), CHROME)
    draw = ImageDraw.Draw(sheet)
    for c, (name, note, make) in enumerate(concepts):
        scene = make()
        x0 = c * col_w + pad
        draw.text((x0, 8), name, fill=LABEL, font=FONT)
        draw.text((x0, 26), note, fill="#8a8a86", font=FONT)
        y = head + pad
        paste_row(sheet, y, x0, [tile_cell(scene, OBSIDIAN, 256)])  # row 1: the app tile
        y += rows_h[0]
        paste_row(sheet, y, x0, [glyph_cell(scene, p, 64) for p in PALETTES] + [tile_cell(scene, OBSIDIAN, 64)])
        y += rows_h[1]
        paste_row(sheet, y, x0, [glyph_cell(scene, p, 32) for p in PALETTES] + [tile_cell(scene, OBSIDIAN, 32)])
        y += rows_h[2]
        small = [glyph_cell(scene, p, 16) for p in PALETTES] + [tile_cell(scene, OBSIDIAN, 16), tile_cell(scene, PAPER, 16)]
        paste_row(sheet, y, x0, small)
        y += rows_h[3]
        zoom = [im.resize((im.width * 8, im.height * 8), Image.NEAREST)
                for im in (tile_cell(scene, OBSIDIAN, 16), glyph_cell(scene, PAPER, 16))]
        paste_row(sheet, y, x0, zoom, gap=12)
    sheet.convert("RGB").save(out)


def socket_d(stem_w: float, bowl_r: float = 24, gap: float = 5, stem_h: float = 74, bowl_cx: float = 43,
             stem_role: str = INK, bowl_role: str = ACCENT) -> Scene:
    """Dot in a socket cut from a tall pill; the bowl and stem bottoms are level."""
    s = Scene()
    base = 88.0
    cy = base - bowl_r
    stem_x = bowl_cx + bowl_r - (stem_w - 17) * 0.25  # the stem's left edge sits just inside the bowl
    stem = capsule(stem_x, base - stem_h, stem_w, stem_h, stem_role)
    s.cut(stem, (circle(bowl_cx, cy, bowl_r + gap, INK),), "socket")
    s.circle(bowl_cx, cy, bowl_r, bowl_role)
    return s


def socket_ring(stem_w: float = 24, bowl_r: float = 25, ring: float = 11, gap: float = 5) -> Scene:
    """A red ring in a socket: the counter stays open, so it cannot read as a note."""
    s = Scene()
    base, cx = 88.0, 42.0
    cy = base - bowl_r
    stem = capsule(cx + bowl_r - 2, base - 74, stem_w, 74, INK)
    s.cut(stem, (circle(cx, cy, bowl_r + gap, INK),), "ring-socket")
    s.circle(cx, cy, bowl_r, ACCENT).circle(cx, cy, bowl_r - ring, TILE)
    return s


def counter_d() -> Scene:
    """A geometric d in ivory, the red dot living in its counter."""
    s = Scene()
    base, r, cx = 88.0, 26.0, 40.0
    cy = base - r
    s.capsule(cx + r - 13, base - 74, 20, 74)
    s.circle(cx, cy, r, INK).circle(cx, cy, r - 12, TILE)
    s.circle(cx, cy, 8.5, ACCENT)
    return s


def trail_d() -> Scene:
    """The docked d with two dim dots following it in."""
    s = socket_d(24, bowl_r=22, bowl_cx=52)
    s.circle(21, 66, 5.5, DIM).circle(8, 66, 3, DIM)
    return s


ROUND2: list[tuple[str, str, Callable[[], Scene]]] = [
    ("A slim stem", "17 wide, original", lambda: socket_d(17)),
    ("B socket", "26 wide, deeper", lambda: socket_d(26)),
    ("C inverse", "ivory dot, red pill", lambda: socket_d(26, stem_role=ACCENT, bowl_role=INK)),
    ("D ring", "open counter", socket_ring),
    ("E counter d", "red dot in the d", counter_d),
    ("F trail", "dot arriving", trail_d),
]


def dock_of_dots() -> Scene:
    """The dock as a column of three dots beside the red one."""
    s = Scene()
    s.circle(37, 62, 24, ACCENT)
    for cy in (22, 44, 66):
        s.circle(74, cy + 2, 10, INK)
    return s


def perforated() -> Scene:
    """The socket d with three small dots punched through the pill."""
    s = socket_d(26)
    for cy in (28, 44, 60):
        s.circle(77.75, cy, 3.6, TILE)
    return s


def lattice_d() -> Scene:
    """The socket d over a faint lattice of dots: how the mark sits on large artwork."""
    s = Scene()
    for iy in range(5):
        for ix in range(5):
            s.circle(10 + ix * 20, 10 + iy * 20, 2.6, DIM)
    s.items.extend(socket_d(26).items)
    return s


ROUND3: list[tuple[str, str, Callable[[], Scene]]] = [
    ("G dock of dots", "three dots and a red one", dock_of_dots),
    ("H perforated", "holes through the pill", perforated),
    ("I lattice", "on the dot field", lattice_d),
    ("B socket", "reference", lambda: socket_d(26)),
]


def tuned_d(w: float, h: float, gap: float, overlap: float, r: float) -> Scene:
    """The socket d, centred on its bounding box. `overlap` is how far the pill reaches into the bowl's span."""
    s = Scene()
    total = 2 * r + w - overlap
    cx = 50 - total / 2 + r
    base = 50 + h / 2
    cy = base - r
    stem = capsule(cx + r - overlap, base - h, w, h, INK)
    s.cut(stem, (circle(cx, cy, r + gap, INK),), "tuned")
    s.circle(cx, cy, r, ACCENT)
    return s


ROUND4: list[tuple[str, str, Callable[[], Scene]]] = [
    ("1 w24 h72", "gap4 ov4 r24", lambda: tuned_d(24, 72, 4, 4, 24)),
    ("2 w22 h70", "gap4 ov6 r24", lambda: tuned_d(22, 70, 4, 6, 24)),
    ("3 w24 h68", "gap5 ov6 r24", lambda: tuned_d(24, 68, 5, 6, 24)),
    ("4 w20 h72", "gap4 ov8 r24", lambda: tuned_d(20, 72, 4, 8, 24)),
    ("5 w26 h72", "gap5 ov8 r24", lambda: tuned_d(26, 72, 5, 8, 24)),
    ("6 w24 h72", "gap4 ov4 r22", lambda: tuned_d(24, 72, 4, 4, 22)),
]


def final_sheet(out: Path) -> None:
    """The shipped mark as built by build.py, at every size and background the brief names."""
    import compose
    from mark import MASTER, PIXEL_SIZES

    pages = [("dark taskbar", "#202020", OBSIDIAN), ("light taskbar", "#f3f3f3", PAPER), ("Aurum", "#0c0c0c", AURUM),
             ("on gold, one colour", "#e2b453", ON_GOLD)]
    sizes = (256, 64, 32, 16)
    pad = 20
    cell_w = sizes[0] + 2 * pad
    row_h = [px + 2 * pad for px in sizes]
    sheet = Image.new("RGB", (cell_w * len(pages), 40 + sum(row_h)), CHROME)
    draw = ImageDraw.Draw(sheet)
    for c, (name, page, pal) in enumerate(pages):
        x0 = c * cell_w
        draw.rectangle((x0, 40, x0 + cell_w, sheet.height), fill=page)
        draw.text((x0 + pad, 12), name, fill=LABEL, font=FONT)
        y = 40
        for px, h in zip(sizes, row_h):
            spec = PIXEL_SIZES.get(px, MASTER)
            shown = [compose.tile_png(px, pal)]
            if px != sizes[0]:  # the bare glyph, without its tile, beside it
                markup = compose.document(compose.glyph(spec, pal.accent, pal.ink), f"0 0 {spec.box:g} {spec.box:g}", "mark")
                shown.append(raster_size(markup, px, px))
            x = x0 + pad
            for im in shown:
                sheet.paste(im, (x, y + pad), im)
                x += px + pad
            y += h
    sheet.save(out / "final.png")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=".cache/brand")
    out = Path(ap.parse_args().out)
    out.mkdir(parents=True, exist_ok=True)
    final_sheet(out)
    build_sheet(CONCEPTS[:5], out / "round1-a.png")
    build_sheet(CONCEPTS[5:], out / "round1-b.png")
    build_sheet(ROUND2, out / "round2.png")
    build_sheet(ROUND3, out / "round3.png")
    build_sheet(ROUND4, out / "round4.png")
    for name, _note, make in CONCEPTS:
        slug = name.replace(" ", "-")
        (out / f"concept-{slug}.svg").write_text(to_svg(make(), OBSIDIAN, tile_radius=TILE_RADIUS), encoding="utf-8")


if __name__ == "__main__":
    main()

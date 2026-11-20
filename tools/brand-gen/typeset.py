"""Text for the brand artwork, turned into shapes so it renders the same everywhere.

Doto (the dot-matrix wordmark face) is cut into its dots: every dot of every letter becomes a circle
on the font's 100 unit lattice. Geist and Geist Mono (labels and taglines) are shaped with HarfBuzz
and outlined to paths. All three fonts are SIL OFL 1.1 and live in `assets/web/fonts`.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

FONT_DIR = Path(__file__).resolve().parents[2] / "assets" / "web" / "fonts"

DOTO_WEIGHT = 800  # the weight the website wordmark uses
DOTO_ROUNDNESS = 100  # round dots, not square ones
DOTO_PITCH = 100  # font units between dot centres: the lattice of the face
CIRCLE_TOLERANCE = 2  # font units a contour's width and height may differ and still count as a circle


@dataclass(frozen=True)
class Dot:
    cx: float
    cy: float
    r: float


@dataclass(frozen=True)
class DotText:
    """Dots in font units with y down; the ink's top-left corner is the origin."""

    dots: tuple[Dot, ...]
    width: float
    height: float


@lru_cache(maxsize=None)
def _instance(font_file: str, wght: float, rond: float | None = None) -> TTFont:
    location: dict[str, float] = {"wght": wght}
    if rond is not None:
        location["ROND"] = rond
    font = instancer.instantiateVariableFont(TTFont(FONT_DIR / font_file), location, inplace=False)
    font.flavor = None  # HarfBuzz reads plain sfnt, not WOFF2
    return font


def doto_dots(text: str) -> DotText:
    font = _instance("Doto.woff2", DOTO_WEIGHT, DOTO_ROUNDNESS)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    found: list[tuple[float, float, float]] = []
    pen_x = 0.0
    for ch in text:
        name = cmap[ord(ch)]
        rec = DecomposingRecordingPen(glyphs)
        glyphs[name].draw(rec)
        contour: list[tuple[str, tuple]] = []
        for op, args in rec.value:
            contour.append((op, args))
            if op in ("closePath", "endPath"):
                bounds = BoundsPen(glyphs)
                for recorded_op, recorded_args in contour:
                    getattr(bounds, recorded_op)(*recorded_args)
                x0, y0, x1, y1 = bounds.bounds
                if abs((x1 - x0) - (y1 - y0)) > CIRCLE_TOLERANCE:
                    raise ValueError(f"glyph {ch!r} has a contour that is not a circle")
                found.append((pen_x + (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2))
                contour = []
        pen_x += glyphs[name].width
    left = min(cx - r for cx, _, r in found)
    right = max(cx + r for cx, _, r in found)
    bottom = min(cy - r for _, cy, r in found)  # font y is up
    top = max(cy + r for _, cy, r in found)
    dots = tuple(Dot(cx - left, top - cy, r) for cx, cy, r in sorted(found))
    return DotText(dots=dots, width=right - left, height=top - bottom)


@lru_cache(maxsize=None)
def _shaper(font_file: str, weight: float) -> tuple[TTFont, hb.Font]:
    font = _instance(font_file, weight)
    buffer = io.BytesIO()
    font.save(buffer)
    return font, hb.Font(hb.Face(buffer.getvalue()))


def shaped_path(font_file: str, text: str, size: float, weight: float, tracking: float = 0.0) -> tuple[str, float]:
    """Outline `text` at `size` px with its baseline at y = 0. Returns the path data and the advance width."""
    font, hb_font = _shaper(font_file, weight)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hb_font, buf, {"kern": True, "liga": True})
    glyphs = font.getGlyphSet()
    scale = size / font["head"].unitsPerEm
    x = 0.0
    parts: list[str] = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = font.getGlyphName(info.codepoint)
        pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x + pos.x_offset * scale, -pos.y_offset * scale)))
        parts.append(pen.getCommands())
        x += pos.x_advance * scale + tracking * size
    return "".join(parts), x - tracking * size

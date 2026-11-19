"""Tiny SVG scene kit shared by the brand explorations and the final mark.

A scene is a list of shapes on a square design box. Each shape names a colour role, not a
colour, so one scene renders in every palette (dark, light, Aurum, one colour). Rendering goes
through resvg, so what is checked here is what a browser or Windows will draw.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field

import resvg_py
from PIL import Image

INK, ACCENT, DIM, TILE = "ink", "accent", "dim", "tile"


@dataclass(frozen=True)
class Palette:
    name: str
    page: str
    tile: str
    ink: str
    accent: str
    dim_opacity: float = 0.32

    def paint(self, role: str) -> tuple[str, float]:
        """Colour and opacity for a role."""
        if role == INK:
            return self.ink, 1.0
        if role == ACCENT:
            return self.accent, 1.0
        if role == DIM:
            return self.ink, self.dim_opacity
        if role == TILE:
            return self.tile, 1.0
        raise ValueError(role)


# Colours come from apps/desktop/src/design-system/themes.ts (Obsidian, Paper, Aurum).
OBSIDIAN = Palette("obsidian", page="#111111", tile="#111111", ink="#e8e6e3", accent="#e94248")
PAPER = Palette("paper", page="#e8e6e3", tile="#e8e6e3", ink="#111111", accent="#e2363d")
AURUM = Palette("aurum", page="#0c0c0c", tile="#0c0c0c", ink="#f5f4f1", accent="#e2b453")
ON_GOLD = Palette("on-gold", page="#e2b453", tile="#e2b453", ink="#111111", accent="#111111")


@dataclass(frozen=True)
class Shape:
    """One SVG element. `geometry` is the element's own attributes (no paint)."""

    tag: str
    geometry: str
    role: str
    stroke: float | None = None  # set for outlines: stroked, not filled

    def markup(self, pal: Palette, extra: str = "") -> str:
        colour, opacity = pal.paint(self.role)
        if self.stroke is None:
            paint = f'fill="{colour}"' + (f' fill-opacity="{opacity:g}"' if opacity != 1 else "")
        else:
            paint = (f'fill="none" stroke="{colour}" stroke-width="{self.stroke:g}" '
                     'stroke-linecap="round" stroke-linejoin="round"'
                     + (f' stroke-opacity="{opacity:g}"' if opacity != 1 else ""))
        return f"<{self.tag} {self.geometry} {paint}{extra}/>"


@dataclass(frozen=True)
class Cut:
    """A shape with `cuts` removed from it (exploration only; the final mark is plain paths)."""

    shape: Shape
    cuts: tuple[Shape, ...]
    mask_id: str

    def markup(self, pal: Palette, box: float) -> str:
        black = Palette("cut", page="#000", tile="#000", ink="#000", accent="#000")
        cut_markup = "".join(c.markup(black, ' style="fill:#000"') for c in self.cuts)
        mask = (f'<mask id="{self.mask_id}" maskUnits="userSpaceOnUse" x="0" y="0" width="{box:g}" height="{box:g}">'
                f'<rect width="{box:g}" height="{box:g}" fill="#fff"/>{cut_markup}</mask>')
        return mask + f'<g mask="url(#{self.mask_id})">{self.shape.markup(pal)}</g>'


@dataclass
class Scene:
    """Shapes in a 100 x 100 design box, drawn in order."""

    items: list[Shape | Cut] = field(default_factory=list)
    box: float = 100.0

    def circle(self, cx: float, cy: float, r: float, role: str = INK) -> "Scene":
        self.items.append(circle(cx, cy, r, role))
        return self

    def capsule(self, x: float, y: float, w: float, h: float, role: str = INK) -> "Scene":
        self.items.append(capsule(x, y, w, h, role))
        return self

    def rrect(self, x: float, y: float, w: float, h: float, rx: float, role: str = INK) -> "Scene":
        self.items.append(Shape("rect", f'x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{rx:g}"', role))
        return self

    def path(self, d: str, role: str = INK, stroke: float | None = None) -> "Scene":
        self.items.append(Shape("path", f'd="{d}"', role, stroke))
        return self

    def cut(self, shape: Shape, cuts: tuple[Shape, ...], mask_id: str) -> "Scene":
        self.items.append(Cut(shape, cuts, mask_id))
        return self


def circle(cx: float, cy: float, r: float, role: str = INK) -> Shape:
    return Shape("circle", f'cx="{cx:g}" cy="{cy:g}" r="{r:g}"', role)


def capsule(x: float, y: float, w: float, h: float, role: str = INK) -> Shape:
    rx = min(w, h) / 2
    return Shape("rect", f'x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{rx:g}"', role)


def to_svg(scene: Scene, pal: Palette, *, tile_radius: float | None = None, page: bool = False) -> str:
    """The scene as a standalone SVG. `tile_radius` adds the rounded-square app tile behind it."""
    box = scene.box
    back = ""
    if tile_radius is not None:
        back = f'<rect width="{box:g}" height="{box:g}" rx="{tile_radius:g}" fill="{pal.tile}"/>'
    elif page:
        back = f'<rect width="{box:g}" height="{box:g}" fill="{pal.page}"/>'
    body = "".join(i.markup(pal, box) if isinstance(i, Cut) else i.markup(pal) for i in scene.items)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {box:g} {box:g}">{back}{body}</svg>'


def raster_size(svg: str, width: int, height: int, *, crisp: bool = False) -> Image.Image:
    """Rasterise to RGBA at exactly width x height."""
    data = resvg_py.svg_to_bytes(
        svg_string=svg, width=width, height=height,
        shape_rendering="crisp_edges" if crisp else "geometric_precision",
    )
    return Image.open(io.BytesIO(bytes(data))).convert("RGBA")


def raster(svg: str, px: int, *, crisp: bool = False) -> Image.Image:
    """Rasterise to RGBA at exactly px x px."""
    return raster_size(svg, px, px, crisp=crisp)

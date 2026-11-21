"""The dotDock mark: a dot docked in a socket cut from a tall pill. It reads as a lowercase 'd'.

It is the 'd' of the Doto wordmark with its dots fused: the bowl's dots become one dot, the stem's
dots become one pill. Every size of the master sits on a 4 unit lattice (`UNIT`) on a 96 unit tile, so
each edge lands on a dot-matrix grid line.

`Spec` is one drawing of the mark. `MASTER` is the large drawing; `PIXEL_SIZES` holds the hand-tuned
drawings for the sizes where a fraction of a pixel matters (16, 20, 24 and 32 px): whole-pixel
edges, a gap that stays one or two pixels wide, and no socket where it would only smear.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

UNIT = 4  # lattice unit on the 96 unit master


@dataclass(frozen=True)
class Spec:
    """One drawing of the mark on a square tile `box` units wide (1 unit = 1 px for pixel drawings)."""

    box: float
    tile_radius: float
    bowl_r: float  # the dot
    stem_w: float  # the pill
    stem_h: float
    gap: float  # clear space between the dot and the pill
    left: float  # x of the dot's left edge; the glyph is placed by hand, never by formula
    base: float  # y of the shared bottom edge of the dot and the pill
    overlap: float | None = None  # how far the pill reaches in beside the dot; None is a plain pill, no socket

    @property
    def bowl_cx(self) -> float:
        return self.left + self.bowl_r

    @property
    def bowl_cy(self) -> float:
        return self.base - self.bowl_r

    @property
    def stem_x(self) -> float:
        if self.overlap is None:
            return self.bowl_cx + self.bowl_r + self.gap
        return self.bowl_cx + self.bowl_r - self.overlap

    @property
    def stem_top(self) -> float:
        return self.base - self.stem_h

    @property
    def extent(self) -> tuple[float, float, float, float]:
        """Left, top, right, bottom of the drawn glyph."""
        return self.left, self.stem_top, self.stem_x + self.stem_w, self.base

    def scaled(self, factor: float) -> "Spec":
        """The same drawing on a tile `factor` times as large."""
        return Spec(
            box=self.box * factor, tile_radius=self.tile_radius * factor, bowl_r=self.bowl_r * factor,
            stem_w=self.stem_w * factor, stem_h=self.stem_h * factor, gap=self.gap * factor,
            left=self.left * factor, base=self.base * factor,
            overlap=None if self.overlap is None else self.overlap * factor,
        )


def _num(v: float) -> str:
    text = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def bowl_svg(spec: Spec, fill: str | None = None, extra: str = "") -> str:
    paint = "" if fill is None else f' fill="{fill}"'
    return f'<circle cx="{_num(spec.bowl_cx)}" cy="{_num(spec.bowl_cy)}" r="{_num(spec.bowl_r)}"{paint}{extra}/>'


def bowl_path(spec: Spec) -> str:
    """The dot as path data, for the one-path mono mark."""
    cx, cy, r = spec.bowl_cx, spec.bowl_cy, spec.bowl_r
    return f"M{_num(cx - r)} {_num(cy)}a{_num(r)} {_num(r)} 0 1 0 {_num(2 * r)} 0a{_num(r)} {_num(r)} 0 1 0 {_num(-2 * r)} 0Z"


def stem_path(spec: Spec) -> str:
    """The pill as one closed path: a capsule with the dot's socket cut from its lower left."""
    x, top, w, h = spec.stem_x, spec.stem_top, spec.stem_w, spec.stem_h
    rx = w / 2
    bottom = top + h
    right = x + w
    head = f"M{_num(x)} {_num(top + rx)}A{_num(rx)} {_num(rx)} 0 0 1 {_num(right)} {_num(top + rx)}V{_num(bottom - rx)}"
    if spec.overlap is None:
        return f"{head}A{_num(rx)} {_num(rx)} 0 0 1 {_num(x)} {_num(bottom - rx)}Z"
    cx, cy, cut_r = spec.bowl_cx, spec.bowl_cy, spec.bowl_r + spec.gap
    dy = math.sqrt(cut_r**2 - (x - cx) ** 2)
    upper_y, lower_y = cy - dy, cy + dy
    if upper_y < top + rx:
        raise ValueError("the socket reaches the pill's top cap; shorten the overlap")
    if lower_y <= bottom - rx:
        # the socket ends on the straight left edge
        d = f"{head}A{_num(rx)} {_num(rx)} 0 0 1 {_num(x)} {_num(bottom - rx)}V{_num(lower_y)}"
    else:
        # the socket ends on the bottom cap: where the cut circle crosses the cap circle
        lx, ly = _circle_hit(cx, cy, cut_r, x + rx, bottom - rx, rx)
        d = f"{head}A{_num(rx)} {_num(rx)} 0 0 1 {_num(lx)} {_num(ly)}"
    return f"{d}A{_num(cut_r)} {_num(cut_r)} 0 0 0 {_num(x)} {_num(upper_y)}Z"


def _circle_hit(x0: float, y0: float, r0: float, x1: float, y1: float, r1: float) -> tuple[float, float]:
    """The lower-left intersection of two circles."""
    dist = math.hypot(x1 - x0, y1 - y0)
    a = (r0**2 - r1**2 + dist**2) / (2 * dist)
    h = math.sqrt(max(r0**2 - a**2, 0.0))
    mx, my = x0 + a * (x1 - x0) / dist, y0 + a * (y1 - y0) / dist
    hits = [(mx + h * (y1 - y0) / dist, my - h * (x1 - x0) / dist), (mx - h * (y1 - y0) / dist, my + h * (x1 - x0) / dist)]
    return min(hits, key=lambda p: (p[0], -p[1]))


def stem_svg(spec: Spec, fill: str | None = None, extra: str = "") -> str:
    paint = "" if fill is None else f' fill="{fill}"'
    return f'<path d="{stem_path(spec)}"{paint}{extra}/>'


MASTER = Spec(box=96, tile_radius=22, bowl_r=24, stem_w=24, stem_h=72, gap=4, left=14, base=84, overlap=4)

PIXEL_SIZES: dict[int, Spec] = {
    16: Spec(box=16, tile_radius=3.5, bowl_r=4, stem_w=3, stem_h=12, gap=1, left=2, base=14),
    20: Spec(box=20, tile_radius=4.5, bowl_r=5, stem_w=5, stem_h=16, gap=1, left=3, base=18, overlap=1),
    24: Spec(box=24, tile_radius=5.5, bowl_r=6, stem_w=6, stem_h=18, gap=1, left=4, base=21, overlap=1),
    32: Spec(box=32, tile_radius=7, bowl_r=8, stem_w=8, stem_h=24, gap=2, left=5, base=28, overlap=2),
}

"""The hero's flowers: two bouquets that rise behind the screen at either side of the headline, and two
low tufts of flowers and grass that stand in front of the screen's lower corners.

Everything is a mosaic of square cells (see pixel.py). A bouquet is laid out in fractions of its canvas
so the narrow render (mobile) is the same picture, redrawn with a coarser cell and fewer flowers.
Layers: ``stalk`` (stems, leaves, grass), ``petal`` (red), ``gold`` (sunflower petals, cosmos eyes),
``heart`` (dark centres) and ``grain`` (a halftone stipple of the shadow they throw).
"""
from __future__ import annotations

import numpy as np

from .dots import F32
from .pixel import FLOWERS, Canvas, cell_stem, daisy, grass, stem_with_leaves, tulip

# Each flower: (kind, head x, head y, radius as fractions of the canvas width/height/width,
#               base x, base y, bend, leaves). Left bouquet; the right one is drawn from its own list.
_BOUQUETS = {
    "left": [
        ("sunflower", 0.30, 0.38, 0.235, 0.68, 1.02, -0.05, (0.45, 0.62, 0.78)),
        ("poppy", 0.70, 0.74, 0.150, 0.80, 1.02, 0.03, (0.55,)),
    ],
    "right": [
        ("poppy", 0.68, 0.36, 0.215, 0.30, 1.02, 0.05, (0.46, 0.64, 0.80)),
        ("sunflower", 0.25, 0.70, 0.170, 0.18, 1.02, -0.03, (0.56,)),
    ],
}

# Small flowers, drawn on the cell grid: (kind, head x, head y, base x as fractions of the canvas; stem leaf rows
# as fractions of the way down; daisy radius in cells). A daisy's stem starts under its head, a tulip's under its cup.
_SMALL = {
    "left": [("daisy", 0.13, 0.78, 0.50, (0.35, 0.62), 4.0), ("tulip", 0.56, 0.20, 0.64, (0.45, 0.75), 0.0)],
    "right": [("daisy", 0.87, 0.80, 0.46, (0.40, 0.68), 4.0), ("tulip", 0.40, 0.18, 0.30, (0.42, 0.72), 0.0)],
}


def _finish(cv: Canvas, loose: list[tuple[str, float, float, float, int]]) -> dict[str, np.ndarray]:
    for layer, x, y, r, n in loose:
        cv.loose_cells(layer, x, y, r, n)
    out = {name: cv.mosaic(name) for name in ("stalk", "petal", "gold", "heart")}
    silhouette = np.clip(sum(out.values()), 0.0, 1.0)
    out["grain"] = cv.stipple(silhouette, 7.0, 9.0, 3.4)
    return {k: v.astype(F32) for k, v in out.items()}


def render_bouquet(width: int, height: int, scale: float, seed: int, side: str, narrow: bool) -> dict[str, np.ndarray]:
    """``width`` x ``height`` are CSS pixels; the arrays are ``scale`` times larger."""
    cell = 5.0 if narrow else 8.0
    cv = Canvas(width, height, scale, cell=cell, rng=np.random.default_rng(seed))
    stems = 0.85 * cell                                            # a stem is one cell wide
    loose = []
    flowers = _BOUQUETS[side][: 2 if narrow else 3]
    for kind, fx, fy, fr, bx, by, bend, leaves in flowers:
        cx, cy, r = fx * width, fy * height, fr * width
        stem_with_leaves(cv, (cx, cy), (bx * width, by * height), bend * width, stems, leaves, r * 0.9)
    for kind, fx, fy, fr, *_ in flowers:
        cx, cy, r = fx * width, fy * height, fr * width
        FLOWERS[kind](cv, cx, cy, r)
        loose.append(("petal" if kind != "sunflower" else "gold", cx, cy, r, 14 if not narrow else 6))
    _small_flowers(cv, side, width, height, cell)
    return _finish(cv, loose)


def _small_flowers(cv: Canvas, side: str, width: int, height: int, cell: float) -> None:
    rows = int(height // cell)
    for kind, fx, fy, bx, leaves, radius in _SMALL[side]:
        gx, gy = int(fx * width // cell), int(fy * height // cell)
        top = gy + (int(radius) + 1 if kind == "daisy" else 4)            # first stem row, just under the head
        leaf_rows = tuple(top + int(t * (rows - top)) for t in leaves)
        cell_stem(cv, gx + (0 if kind == "daisy" else 2), top, int(bx * width // cell), rows, leaf_rows)
        if kind == "daisy":
            daisy(cv, gx, gy, radius)
        else:
            tulip(cv, gx, gy)


def render_tuft(width: int, height: int, scale: float, seed: int, side: str, narrow: bool) -> dict[str, np.ndarray]:
    """Grass with a few small flowers, thickest at the corner of the screen it stands against."""
    rng = np.random.default_rng(seed)
    cell = 4.0 if narrow else 6.0
    cv = Canvas(width, height, scale, cell=cell, rng=rng)
    inner = 1.0 if side == "left" else -1.0                       # which way the tuft leans (towards the screen)
    count = 16 if narrow else 30
    for i in range(count):
        t = rng.random()
        x = (0.06 + 0.78 * t) * width if side == "left" else (0.94 - 0.78 * t) * width
        tall = height * (0.34 + 0.50 * (1.0 - t) ** 1.2) * rng.uniform(0.7, 1.0)
        grass(cv, x, height * 1.02, tall, inner * rng.uniform(-0.04, 0.14) * width, 0.85 * cell)
    spots = ((0.22, 0.50, 0.17, "poppy"), (0.50, 0.66, 0.12, "cosmos"), (0.10, 0.74, 0.10, "cosmos"))
    loose = []
    for fx, fy, fr, kind in spots[: 2 if narrow else 3]:
        fx = fx if side == "left" else 1.0 - fx
        cx, cy, r = fx * width, fy * height, fr * width
        stem_with_leaves(cv, (cx, cy), (cx + inner * 0.06 * width, height * 1.02), inner * 0.03 * width,
                         0.85 * cell, (0.6,), r * 1.1)
        FLOWERS[kind](cv, cx, cy, r)
        loose.append(("petal", cx, cy, r, 5))
    return _finish(cv, loose)

"""Scenes: halftone hills with a garden of pixel flowers, grass, butterflies and bees in front of them.

They sit behind the product shots of the Features page and under the footer. Each kind has its own
flowers and its own seed, so no two scenes repeat each other, and all of them use the hero's pixel scale
(the same cell size), palette and halftone shading. A scene that has a product shot in front of it keeps
its middle clear: the garden stands at the two sides.
Layers: far, mid, near (hills), stalk, petal, gold, heart, grain.
"""
from __future__ import annotations

import math

import numpy as np

from .dots import F32
from .pixel import Canvas, bee, butterfly, cell_stem, daisy, grass, sunflower, poppy, tulip
from .scape import render_scape

# kind -> (hill seed, big flower per side, small flowers per side, butterflies, bees, clear middle)
SCENES: dict[str, tuple[int, tuple[str, str] | None, int, int, int, bool]] = {
    "dock": (51, None, 6, 3, 0, True),
    "island": (52, ("sunflower", "sunflower"), 4, 0, 4, True),
    "home": (53, ("poppy", "poppy"), 4, 2, 0, True),
    "themes": (54, ("sunflower", "poppy"), 4, 3, 1, True),
    "meadow": (55, None, 0, 0, 0, False),
}


def _place(rng: np.random.Generator, taken: list[tuple[float, float]], x_lo: float, x_hi: float, y_lo: float, y_hi: float,
           gap: float) -> tuple[float, float] | None:
    for _ in range(40):
        p = (rng.uniform(x_lo, x_hi), rng.uniform(y_lo, y_hi))
        if all(math.hypot(p[0] - q[0], p[1] - q[1]) > gap for q in taken):
            taken.append(p)
            return p
    return None


def _small_flower(cv: Canvas, rng: np.random.Generator, x: float, y: float, height: float, kind: str) -> None:
    g = cv.cell_css
    rows = int(height // g)
    gx, gy = int(x // g), int(y // g)
    if kind == "daisy":
        top = gy + 5
        cell_stem(cv, gx, top, gx + int(rng.integers(-5, 6)), rows, (top + int((rows - top) * 0.45), top + int((rows - top) * 0.75)))
        daisy(cv, gx, gy, 4.0)
    else:
        top = gy + 4
        cell_stem(cv, gx + 2, top, gx + 2 + int(rng.integers(-5, 6)), rows, (top + int((rows - top) * 0.5),))
        tulip(cv, gx, gy)


def _garden_side(cv: Canvas, rng, width: int, height: int, side: str, big: str | None, count: int, narrow: bool,
                 taken: list[tuple[float, float]]) -> None:
    lo, hi = (0.02, 0.26) if not narrow else (0.02, 0.34)
    x_lo, x_hi = (lo, hi) if side == "left" else (1.0 - hi, 1.0 - lo)
    if big is not None:
        r = (0.075 if not narrow else 0.10) * width
        cx = (x_lo + (x_hi - x_lo) * rng.uniform(0.35, 0.65)) * width
        cy = height * rng.uniform(0.34, 0.46)
        taken.append((cx, cy))
        stem_x = cx + rng.uniform(-0.04, 0.04) * width
        cell_stem(cv, int(cx // cv.cell_css), int((cy + r * 0.45) // cv.cell_css), int(stem_x // cv.cell_css), int(height // cv.cell_css),
                  (int((cy + r) // cv.cell_css) + 3, int((cy + r) // cv.cell_css) + 8))
        (sunflower if big == "sunflower" else poppy)(cv, cx, cy, r)
    for i in range(count):
        p = _place(rng, taken, x_lo * width, x_hi * width, height * 0.42, height * 0.80, 60.0)
        if p is not None:
            _small_flower(cv, rng, p[0], p[1], height, "daisy" if i % 2 else "tulip")
    for _ in range(26 if not narrow else 14):
        x = rng.uniform(x_lo - 0.02, x_hi + 0.02) * width
        grass(cv, x, height * 1.02, height * rng.uniform(0.10, 0.28), rng.uniform(-0.03, 0.03) * width, 0.85 * cv.cell_css)


def render_scene(width: int, height: int, scale: float, seed: int, kind: str, narrow: bool) -> dict[str, np.ndarray]:
    """``width`` x ``height`` are CSS pixels; the arrays are ``scale`` times larger."""
    hill_seed, bigs, small, butterflies, bees, clear_middle = SCENES[kind]
    hills = render_scape(width, height, scale, hill_seed + (7 if narrow else 0), narrow=narrow, hidden=None)
    rng = np.random.default_rng(seed)
    cv = Canvas(width, height, scale, cell=7.0 if narrow else 8.0, rng=rng)
    taken: list[tuple[float, float]] = []
    if clear_middle:
        for side, big in zip(("left", "right"), bigs or (None, None)):
            _garden_side(cv, rng, width, height, side, big, small // 2 + (1 if narrow else 0), narrow, taken)
    else:
        # The footer meadow: a long row of flowers and grass all along the foot, thinning out towards the middle.
        for i in range(10 if not narrow else 5):
            p = _place(rng, taken, 0.02 * width, 0.98 * width, height * 0.45, height * 0.80, 70.0)
            if p is not None:
                _small_flower(cv, rng, p[0], p[1], height, "daisy" if i % 2 else "tulip")
        for _ in range(90 if not narrow else 40):
            grass(cv, rng.uniform(0.0, 1.0) * width, height * 1.02, height * rng.uniform(0.10, 0.34),
                  rng.uniform(-0.03, 0.03) * width, 0.85 * cv.cell_css)
    g = cv.cell_css
    for i in range(butterflies):
        p = _place(rng, taken, 0.04 * width, 0.96 * width, height * 0.08, height * 0.34, 90.0)
        if p is not None:
            butterfly(cv, int(p[0] // g), int(p[1] // g), gold_wings=bool(i % 2))
    for _ in range(bees):
        p = _place(rng, taken, 0.04 * width, 0.96 * width, height * 0.12, height * 0.40, 90.0)
        if p is not None:
            bee(cv, int(p[0] // g), int(p[1] // g))
    out = {name: cv.mosaic(name) for name in ("stalk", "petal", "gold", "heart")}
    silhouette = np.clip(sum(out.values()), 0.0, 1.0)
    out["grain"] = cv.stipple(silhouette, 7.0, 9.0, 3.4)
    return {**hills, **{k: v.astype(F32) for k, v in out.items()}}

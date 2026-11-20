"""Bands: wide, low pictures that sit between sections of a page. A pixel sky, a sea under mountains, a field of trees.

Same pixel scale, palette and halftone shading as the hero's flowers (pixel.py). Layers: far, mid, near (halftone
hills), sea (halftone water), cloud, stalk (trees, grass), petal, gold (sun, glints), heart (trunks, birds), grain.
"""
from __future__ import annotations

import math

import numpy as np

from .dots import F32, fbm, halftone
from .pixel import LIT, MID, SHADE, Canvas, butterfly, daisy, grass, tulip
from .scape import render_scape

KINDS = ("sky", "sea", "field")


def _blob(cv: Canvas, layer: str, gx: int, gy: int, w: int, h: int) -> None:
    """A soft-edged mass of cells (a cloud, a treetop): lit on top, in shade underneath."""
    for j in range(h):
        for i in range(w):
            dx, dy = (i + 0.5 - w / 2) / (w / 2), (j + 0.5 - h / 2) / (h / 2)
            wob = 0.12 * math.sin(i * 1.7) + 0.08 * math.cos(j * 2.3)
            if dx * dx + dy * dy <= 1.0 + wob:
                tone = LIT if dy < -0.15 else MID if dy < 0.45 else SHADE
                cv.fill_cell(layer, gx + i, gy + j, tone)


def _cloud(cv: Canvas, gx: int, gy: int, w: int) -> None:
    h = max(3, w // 3)
    _blob(cv, "cloud", gx, gy + h // 3, w, h)
    _blob(cv, "cloud", gx + w // 5, gy, w // 2, h)
    _blob(cv, "cloud", gx + w // 2, gy + h // 4, w // 2, int(h * 0.8))


def _bird(cv: Canvas, gx: int, gy: int) -> None:
    for i, j in ((0, 0), (1, 1), (2, 1), (3, 0), (-1, -1), (4, -1)):
        cv.fill_cell("heart", gx + i, gy + j, LIT)


def _sun(cv: Canvas, gx: int, gy: int, r: float) -> None:
    n = int(math.ceil(r)) + 1
    for j in range(-n, n + 1):
        for i in range(-n, n + 1):
            d = math.hypot(i, j)
            if d <= r:
                cv.fill_cell("gold", gx + i, gy + j, LIT if (i + j) <= 0 else MID)


def _tree(cv: Canvas, gx: int, base: int, r: int) -> None:
    for j in range(r // 2 + 2):
        cv.fill_cell("heart", gx, base - j, LIT)
    cx, cy = gx, base - r // 2 - r
    for j in range(-r, r + 1):
        for i in range(-r, r + 1):
            d = math.hypot(i * 0.92, j)
            if d <= r + 0.2 * math.sin(i * 1.9 + j):
                lit = (i * -0.57 + j * -0.82) / (d or 1.0)
                cv.fill_cell("stalk", cx + i, cy + j, LIT if lit > 0.25 else MID if lit > -0.45 else SHADE)


def _sea(w: int, h: int, scale: float, seed: int, top: float) -> np.ndarray:
    """Water as halftone rows: coarse dots in front, fine and pale towards the horizon, with a ripple."""
    rng = np.random.default_rng(seed)
    yy = (np.arange(h, dtype=F32) + 0.5) / h
    depth = np.clip((yy - top) / (1.0 - top), 0.0, 1.0)[:, None]
    ripple = fbm(rng, w, h, 14.0, 3, 0.5, stretch=0.06)
    tone = np.where(yy[:, None] >= top, 0.18 + 0.62 * depth ** 0.8 + 0.18 * (ripple - 0.5), 0.0).astype(F32)
    return halftone(np.clip(tone, 0.0, 1.0), 6.5 * scale, 0.0, rmax=0.5, gamma=0.55, floor=0.03)


def render_band(width: int, height: int, scale: float, seed: int, kind: str, narrow: bool) -> dict[str, np.ndarray]:
    """``width`` x ``height`` are CSS pixels; the arrays are ``scale`` times larger."""
    rng = np.random.default_rng(seed)
    cell = 7.0 if narrow else 8.0
    cv = Canvas(width, height, scale, cell=cell, rng=rng)
    g = cv.cell_css
    cols, rows = int(width // g), int(height // g)
    out: dict[str, np.ndarray] = {}
    layers = ("cloud", "stalk", "petal", "gold", "heart")

    if kind == "sky":
        for k, (fx, fy, fw) in enumerate(((0.10, 0.18, 17), (0.34, 0.42, 11), (0.58, 0.14, 21), (0.80, 0.38, 13), (0.95, 0.12, 9))):
            if narrow and k > 2:
                continue
            _cloud(cv, int(fx * cols), int(fy * rows), fw if not narrow else fw * 2 // 3)
        _sun(cv, int(0.70 * cols), int(0.30 * rows), 4.6 if not narrow else 3.6)
        for fx, fy in ((0.22, 0.14), (0.27, 0.22), (0.47, 0.10), (0.88, 0.50), (0.93, 0.44)):
            _bird(cv, int(fx * cols), int(fy * rows))
        hills = render_scape(width, height, scale, seed, narrow=narrow, hidden=None)
        out["far"] = hills["far"] * np.clip((np.arange(cv.h)[:, None] / cv.h - 0.62) * 6.0, 0.0, 1.0).astype(F32)
    elif kind == "sea":
        hills = render_scape(width, height * 1.0, scale, seed, narrow=narrow, hidden=None)
        horizon = 0.50
        rowmask = (np.arange(cv.h)[:, None] / cv.h < horizon + 0.04).astype(F32)
        out["far"] = hills["far"] * rowmask
        out["sea"] = _sea(cv.w, cv.h, scale, seed, horizon)
        _sun(cv, int(0.30 * cols), int(0.22 * rows), 3.6 if not narrow else 3.0)
        for j in range(int(horizon * rows) + 1, rows - 1, 2):
            span = 2 + (j - int(horizon * rows)) // 2
            cx = int(0.30 * cols + rng.integers(-1, 2))
            for i in range(-span, span + 1, 2):
                cv.fill_cell("gold", cx + i, j, LIT if (i + j) % 4 else MID)
        for fx, fy in ((0.62, 0.16), (0.67, 0.24), (0.84, 0.10)):
            _bird(cv, int(fx * cols), int(fy * rows))
        for k in range(3 if not narrow else 1):
            _cloud(cv, int((0.50 + 0.18 * k) * cols), int((0.05 + 0.06 * k) * rows), 11)
    else:  # field
        hills = render_scape(width, height, scale, seed, narrow=narrow, hidden=None)
        mask = (np.arange(cv.h)[:, None] / cv.h > 0.34).astype(F32)
        out["mid"] = hills["mid"] * mask
        out["near"] = hills["near"] * mask
        for i in range(7 if not narrow else 3):
            x = int((0.07 + 0.88 * rng.random()) * cols)
            _tree(cv, x, int(rng.uniform(0.66, 0.84) * rows), int(rng.integers(3, 6)))
        for k in range(14 if not narrow else 6):
            x, y = int(rng.uniform(0.02, 0.98) * cols), int(rng.uniform(0.78, 0.94) * rows)
            if k % 3 == 0:
                daisy(cv, x, y, 2.2)
            else:
                tulip(cv, x, y - 3)
        for k in range(3 if not narrow else 1):
            butterfly(cv, int(rng.uniform(0.1, 0.9) * cols), int(rng.uniform(0.10, 0.34) * rows), gold_wings=bool(k % 2))
        for _ in range(60 if not narrow else 24):
            grass(cv, rng.uniform(0.0, 1.0) * width, height * 1.02, height * rng.uniform(0.06, 0.16), rng.uniform(-0.02, 0.02) * width, 0.85 * g)
    for name in layers:
        out[name] = cv.mosaic(name)
    silhouette = np.clip(sum(out[n] for n in layers), 0.0, 1.0)
    out["grain"] = cv.stipple(silhouette, 6.0, 8.0, 3.4)
    return {k: v.astype(F32) for k, v in out.items()}

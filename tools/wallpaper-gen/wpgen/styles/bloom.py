"""Dot-matrix blooms over bokeh: flowers drawn as a clean lattice of round dots, floating on a blurred olive haze."""
from __future__ import annotations

import math

import numpy as np

from ..core import (F32, Canvas, blur, clamp01, disc_cover, eval_waves_pointwise, lowres_eval, make_waves, rgb, smoothstep,
                    upscale)
from ..flora import bezier, make_whorl, petal_shade, stem_distance
from ..registry import Style

PITCH_REF = 24.0         # dot pitch in 4K pixels
DOT_MAX = 0.50           # largest dot radius, in pitches (tangent discs fill a solid area)
DOT_MIN_B = 0.05         # brightness below which a lattice site stays empty
SUPERSAMPLE = 3          # brightness samples per axis inside one lattice cell
SPARKLES = ((1.10, 0.16), (0.82, 0.34), (1.70, 0.84), (0.62, 0.66))


def _bokeh(c: Canvas, rng, dark: bool) -> np.ndarray:
    """Blurred olive-green haze with warm light leaks and soft discs, as linear-ish sRGB (H, W, 3)."""
    a = c.aspect
    if dark:
        top, mid, bot = rgb("#1b2310"), rgb("#2b3a18"), rgb("#3a4a24")
        leaks = [  # (x, y, sx, sy, colour, gain): warm and white leaks round the frame
            (-0.02, 0.14, 0.16, 0.14, "#d27a2a", 0.30), (0.05, 0.66, 0.10, 0.10, "#c25e1c", 0.14),
            (a + 0.02, 0.54, 0.17, 0.16, "#e8923c", 0.55), (a, 0.58, 0.05, 0.05, "#fff1d0", 0.70),
            (1.06, 0.04, 0.075, 0.30, "#8aa24a", 0.40), (1.40, 0.26, 0.050, 0.22, "#a3b455", 0.16),
            (0.98, 1.04, 0.26, 0.10, "#dfe8c4", 0.10), (1.30, 1.02, 0.44, 0.14, "#d6e4b6", 0.50),
            (1.52, 0.90, 0.07, 0.07, "#fffbe8", 0.45),
        ]
        disc_gain, disc_cols = 0.16, ("#8aa24a", "#b7c46a", "#6a8438", "#d6a45a")
    else:
        top, mid, bot = rgb("#d6dfb6"), rgb("#bccb92"), rgb("#cfd9a8")
        leaks = [
            (-0.02, 0.14, 0.22, 0.18, "#f1c79a", 0.55), (a + 0.02, 0.54, 0.20, 0.18, "#f4c690", 0.55),
            (a, 0.58, 0.06, 0.06, "#fff7e0", 0.70), (1.06, 0.04, 0.085, 0.32, "#f1f3d6", 0.50),
            (0.66, 0.99, 0.40, 0.16, "#f7f4e0", 0.55), (1.28, 1.02, 0.44, 0.15, "#f7f4e0", 0.60),
            (1.56, 0.62, 0.20, 0.26, "#9db76a", 0.40), (0.20, 0.90, 0.26, 0.20, "#a3b97a", 0.34),
        ]
        disc_gain, disc_cols = 0.55, ("#9fb36a", "#8aa35a", "#f2f3d8", "#e9c394")

    def field(xs, ys):
        t = np.clip(ys, 0.0, 1.0)
        w_top = np.clip(1.0 - 2.0 * t, 0.0, 1.0)[..., None]
        w_bot = np.clip(2.0 * t - 1.0, 0.0, 1.0)[..., None]
        w_mid = 1.0 - w_top - w_bot
        img = (top * w_top + mid * w_mid + bot * w_bot).astype(F32)
        img = np.broadcast_to(img, (ys.shape[0], xs.shape[1], 3)).copy()
        for lx, ly, sx, sy, col, g in leaks:
            m = np.exp(-0.5 * (((xs - lx) / sx) ** 2 + ((ys - ly) / sy) ** 2)).astype(F32)
            if dark:
                img += (g * m)[..., None] * rgb(col)
            else:
                img += ((rgb(col) - img) * (g * m)[..., None])
        return img

    base = lowres_eval(c, field, 4)
    # soft bokeh discs: edge-lit, overlapping, deliberately out of focus
    layer = np.zeros((c.h // 4, c.w // 4, 3), dtype=F32)
    ys = ((np.arange(layer.shape[0], dtype=F32) + 0.5) / layer.shape[0])[:, None]
    xs = ((np.arange(layer.shape[1], dtype=F32) + 0.5) / layer.shape[1] * a)[None, :]
    for _ in range(44):
        cx, cy = rng.uniform(0.0, a), rng.uniform(0.0, 1.0) ** 0.8
        r = rng.uniform(0.035, 0.115)
        col = rgb(disc_cols[int(rng.integers(0, len(disc_cols)))])
        d = np.hypot(xs - cx, ys - cy) / r
        disc = smoothstep(1.0, 0.72, d) * (0.65 + 0.35 * smoothstep(0.55, 1.0, d))
        g = disc_gain * rng.uniform(0.35, 1.0) * (0.45 + 0.55 * smoothstep(0.15, 0.55, cx / a))
        if dark:
            layer += (g * disc)[..., None] * col
        else:
            layer += (col - 0.80) * (g * disc)[..., None]
    layer = blur(layer, 2.0)
    return clamp01(base + upscale(layer, c.w, c.h))


def _lattice(c: Canvas):
    p = PITCH_REF * c.h / 2160.0
    nx, ny = int(math.ceil(c.w / p)), int(math.ceil(c.h / p))
    ox, oy = (c.w - nx * p) / 2.0, (c.h - ny * p) / 2.0
    return p, nx, ny, ox, oy


def _bloom_brightness(x, y, bloom, tex, edge, line):
    """Brightness of one flower head at points (x, y) in height units."""
    cx, cy, size, rot, squash, petals, centre, tendrils = bloom
    ca, sa = math.cos(rot), math.sin(rot)
    dx, dy = (x - cx) / size, (y - cy) / size
    px, py = dx * ca + dy * sa, (-dx * sa + dy * ca) / squash
    b = np.zeros(np.broadcast(x, y).shape, dtype=F32)
    for p in petals:
        shade, cover, halo = petal_shade(px, py, p, edge / size)
        b *= 1.0 - 0.75 * halo * (1.0 - cover)
        b = b + (shade * (0.62 + 0.38 * tex) - b) * cover
    r = np.hypot(px, py)
    b *= 1.0 - 0.85 * np.exp(-((r / centre) ** 2))
    for pts in tendrils:
        b = np.maximum(b, 0.92 * np.clip(1.0 - (stem_distance(px, py, pts) * size - line) / line, 0.0, 1.0))
    # stamens: fine chains of dots curling out of the throat
    for k in range(11):
        a0 = k * 2.0 * math.pi / 11 + 0.3 * math.sin(7.0 * k)
        pts = bezier((0, 0), (0.12 * math.cos(a0 + 0.9), 0.12 * math.sin(a0 + 0.9)),
                     (0.30 * math.cos(a0 - 0.5), 0.30 * math.sin(a0 - 0.5)), (0.40 * math.cos(a0), 0.40 * math.sin(a0)), 14)
        b = np.maximum(b, 0.92 * np.clip(1.0 - (stem_distance(px, py, pts) * size - line) / line, 0.0, 1.0))
    return b


def _tendrils(rng, n):
    """Long thin wisps of dots drifting out of a flower's throat in loose S curves (in flower radii)."""
    out = []
    for _ in range(n):
        a0 = rng.uniform(0.0, 2.0 * math.pi)
        spin = rng.choice([-1.0, 1.0])
        angles = a0 + spin * np.array([0.0, 0.30, -0.15, 0.45])
        radii = np.array([0.22, 0.75, 1.15, 1.42])
        out.append(bezier(*[(r * math.cos(t), r * math.sin(t)) for r, t in zip(radii, angles)], 40))
    return out


def _blooms():
    """(cx, cy, size, rotation, squash, petals, throat radius, tendrils) for each flower head."""
    rng = np.random.default_rng(5101)
    main = (1.34, 0.57, 0.37, -0.55, 0.80,
            make_whorl(rng, 6, 1.00, 0.30, -1.2, spread=0.30) + make_whorl(rng, 6, 0.74, 0.22, -0.6, lit_range=(0.80, 1.0)),
            0.15, _tendrils(rng, 3))
    second = (0.88, 0.86, 0.20, 0.45, 0.82,
              make_whorl(rng, 6, 1.00, 0.32, 0.2) + make_whorl(rng, 5, 0.70, 0.24, 0.8, lit_range=(0.8, 1.0)),
              0.17, _tendrils(rng, 2))
    return [main, second]


def _stems():
    s1 = bezier((1.30, 0.66), (1.22, 0.82), (1.40, 0.96), (1.32, 1.08), 30)
    s2 = bezier((0.97, 0.94), (0.92, 1.00), (0.86, 1.04), (0.80, 1.10), 14)
    return [s1, s2]


def _render(c: Canvas, mode: str, seed: int) -> np.ndarray:
    dark = mode == "dark"
    rng = np.random.default_rng(seed)
    bg = _bokeh(c, rng, dark)

    p, nx, ny, ox, oy = _lattice(c)
    ss = SUPERSAMPLE
    sub = (np.arange(ss, dtype=F32) + 0.5) / ss - 0.5
    cxs = ((np.arange(nx, dtype=F32) + 0.5) * p + ox) / c.h
    cys = ((np.arange(ny, dtype=F32) + 0.5) * p + oy) / c.h
    X = cxs[None, :, None, None] + (sub[None, None, None, :] * p / c.h)
    Y = cys[:, None, None, None] + (sub[None, None, :, None] * p / c.h)
    X, Y = np.broadcast_arrays(X, Y)
    edge = 0.5 * p / c.h / ss
    line = 0.30 * p / c.h
    wv = make_waves(rng, 16, 5.0, 22.0, slope=0.7)
    tex = np.clip(0.5 + 0.5 * eval_waves_pointwise(X, Y, wv), 0.0, 1.0)

    bright = np.zeros(X.shape, dtype=F32)
    for bloom in _blooms():
        bright = np.maximum(bright, _bloom_brightness(X, Y, bloom, tex, edge, line))
    for stem in _stems():
        d = stem_distance(X, Y, stem)
        bright = np.maximum(bright, 0.95 * np.clip(1.0 - (d - line) / line, 0.0, 1.0))
    b = bright.mean(axis=(2, 3))

    # sparkles: tiny plus signs made of lattice dots
    for sx, sy in SPARKLES:
        i, j = int((sx * c.h - ox) / p), int((sy * c.h - oy) / p)
        for di, dj, v in ((0, 0, 1.0), (1, 0, 0.45), (-1, 0, 0.45), (0, 1, 0.45), (0, -1, 0.45)):
            if 0 <= j + dj < ny and 0 <= i + di < nx:
                b[j + dj, i + di] = max(b[j + dj, i + di], v)

    r_cell = np.where(b > DOT_MIN_B, DOT_MAX * p * np.clip(b * 1.20, 0.0, 1.0) ** 1.0, 0.0).astype(F32)

    xs = np.arange(c.w, dtype=F32) + 0.5 - ox
    ys = np.arange(c.h, dtype=F32) + 0.5 - oy
    ix = np.clip(np.floor(xs / p).astype(np.int32), 0, nx - 1)
    iy = np.clip(np.floor(ys / p).astype(np.int32), 0, ny - 1)
    fx = xs - (ix + 0.5) * p
    fy = ys - (iy + 0.5) * p
    r = r_cell[iy[:, None], ix[None, :]]
    dist = np.hypot(fx[None, :], fy[:, None])
    cov = disc_cover(r, dist) * (r > 0.0)

    if dark:
        ink = rgb("#f6e9c6")
        glow = clamp01(blur(cov, 0.016 * c.h)) * 0.20
        img = bg + (rgb("#f1dfb0") - bg) * glow[..., None] * 0.9
    else:
        ink = rgb("#1d2812")
        img = bg
    img = img + (ink - img) * cov[..., None]
    return clamp01(img)


STYLES = [
    Style("bloom-dots", "Lattice Bloom", "dot-matrix flowers over bokeh", 5301,
          {"dark": "#f1dfb0", "light": "#2c3a1c"}, _render, {"dark": 2.2, "light": 1.8}),
]

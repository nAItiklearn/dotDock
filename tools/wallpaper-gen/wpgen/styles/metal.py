"""Liquid metal: a domain-warped height field lit by a procedural studio environment.

Gold on black in the dark variant; pale champagne gold on warm white in the light variant.
The metal pools flat and dark on the left, and flows and folds towards the right.
"""
from __future__ import annotations

import numpy as np

from ..core import (F32, Canvas, clamp01, eval_waves_pointwise, linear_to_srgb, make_waves, rgb, smootherstep,
                    srgb_to_linear, upscale)
from ..registry import Style


def _height_and_grad(c: Canvas, rng, factor=4):
    """Warped fold field on a coarse grid; returns upsampled (h, hx, hy) in height units."""
    w_base = make_waves(rng, 14, 0.45, 1.5, slope=1.1)
    w_w1x, w_w1y = make_waves(rng, 8, 0.35, 1.2, slope=0.9), make_waves(rng, 8, 0.35, 1.2, slope=0.9)
    w_w2x, w_w2y = make_waves(rng, 8, 0.6, 1.8, slope=0.9), make_waves(rng, 8, 0.6, 1.8, slope=0.9)

    wl = int(round(c.w / factor))
    hl = int(round(c.h / factor))
    xs = ((np.arange(wl, dtype=F32) + 0.5) / wl * c.aspect)[None, :]
    ys = ((np.arange(hl, dtype=F32) + 0.5) / hl)[:, None]
    X, Y = np.broadcast_arrays(xs, ys)
    X = X.copy()
    Y = Y.copy()
    # two rounds of domain warping give the long, rolled folds of poured metal
    X1 = X + 0.24 * eval_waves_pointwise(X, Y, w_w1x)
    Y1 = Y + 0.24 * eval_waves_pointwise(X, Y, w_w1y)
    X2 = X1 + 0.09 * eval_waves_pointwise(X1, Y1, w_w2x)
    Y2 = Y1 + 0.09 * eval_waves_pointwise(X1, Y1, w_w2y)
    f = eval_waves_pointwise(X2, Y2, w_base)
    # the pool boundaries wander (so no straight highlight lines) and are soft rather than box-shaped
    w_m = make_waves(rng, 6, 0.5, 1.4, slope=0.8)
    wob = eval_waves_pointwise(X, Y, w_m)
    u = X / c.aspect + 0.055 * wob
    v = Y + 0.05 * wob
    corner = np.sqrt(((X - c.aspect) / 0.95) ** 2 + (Y / 0.80) ** 2)          # distance from the top-right corner
    mask = (smootherstep(0.36, 0.82, u) ** 1.3) * smootherstep(0.55, 1.05, corner + 0.06 * wob)
    h = (f * mask).astype(F32)
    pitch_x = c.aspect / wl
    pitch_y = 1.0 / hl
    hy, hx = np.gradient(h, pitch_y, pitch_x)
    return (upscale(h, c.w, c.h), upscale(hx.astype(F32), c.w, c.h), upscale(hy.astype(F32), c.w, c.h),
            upscale(mask.astype(F32), c.w, c.h))


def _strip(rx, ry, ang, centre, width):
    """A soft line light in direction space: gaussian across the strip normal."""
    d = rx * np.cos(ang) + ry * np.sin(ang)
    return np.exp(-(((d - centre) / width) ** 2))


def _render(c: Canvas, mode: str, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    dark = mode == "dark"
    h, hx, hy, mask = _height_and_grad(c, rng)
    k = 0.62
    nx, ny = -k * hx, -k * hy
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + 1.0)
    nx, ny, nz = nx * inv, ny * inv, inv
    # mirror reflection of a view straight down the z axis
    rx = 2.0 * nz * nx
    ry = 2.0 * nz * ny

    if dark:
        e = 0.002 + 0.012 * np.clip(-ry * 0.5 + 0.5, 0, 1) ** 2
        e = e + 2.0 * _strip(rx, ry, -np.pi / 2, 0.40, 0.065)           # overhead softbox edge
        e = e + 0.55 * _strip(rx, ry, -np.pi / 2, 0.44, 0.17)
        e = e + 1.4 * _strip(rx, ry, 0.35, -0.30, 0.040)                # thin strip light
        e = e + 0.9 * _strip(rx, ry, 2.7, 0.18, 0.060)
        e = e + 0.6 * _strip(rx, ry, 0.0, 0.55, 0.14)
        f0 = srgb_to_linear(rgb("#f4a840"))
        lin = f0 * e[..., None]
        img = 1.0 - np.exp(-lin * 1.7)
        img = linear_to_srgb(img + srgb_to_linear(rgb("#050505")))
    else:
        e = 1.05 - 0.95 * _strip(rx, ry, -np.pi / 2, 0.40, 0.14)         # dark reflections of the room
        e = e - 0.70 * _strip(rx, ry, 0.35, -0.30, 0.08)
        e = e - 0.55 * _strip(rx, ry, 2.7, 0.15, 0.12)
        e = e - 0.50 * _strip(rx, ry, 0.0, 0.55, 0.12)
        e = e + 1.3 * _strip(rx, ry, -np.pi / 2, 0.46, 0.035)          # specular glints
        e = e + 0.9 * _strip(rx, ry, 0.35, -0.24, 0.025)
        e = np.clip(e, 0.10, 2.8)
        f0 = srgb_to_linear(rgb("#f1d493"))
        lin = f0 * e[..., None]
        img = 1.0 - np.exp(-lin * 1.45)
        img = linear_to_srgb(img)
        cream = rgb("#ebe7de")
        calm = (1.0 - mask)[..., None]
        img = img + (cream - img) * calm * 0.80
    return clamp01(img)


STYLES = [
    Style("liquid-gold", "Molten Gold", "liquid metal", 8101,
          {"dark": "#e0a93c", "light": "#d9b66a"}, _render, {"dark": 1.5, "light": 1.4}),
]

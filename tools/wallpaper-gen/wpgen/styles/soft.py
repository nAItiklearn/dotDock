"""Soft monochrome: overlapping matte spheres in a hazy room, heavy film grain, one hairline ring and a red dot."""
from __future__ import annotations

import math

import numpy as np

from ..core import F32, Canvas, blur, clamp01, rgb, smoothstep
from ..registry import Style


def _shift(a, dx_px, dy_px):
    h, w = a.shape
    out = np.zeros_like(a)
    sx, sy = int(round(dx_px)), int(round(dy_px))
    ys, yd = (slice(0, h - sy), slice(sy, h)) if sy >= 0 else (slice(-sy, h), slice(0, h + sy))
    xs, xd = (slice(0, w - sx), slice(sx, w)) if sx >= 0 else (slice(-sx, w), slice(0, w + sx))
    out[yd, xd] = a[ys, xs]
    return out


def _sphere(c: Canvas, cx, cy, R, light):
    """Matte sphere: returns (shade 0..1 incl. soft terminator + bounce, coverage)."""
    dx, dy = (c.x - cx) / R, (c.y - cy) / R
    rho2 = dx * dx + dy * dy
    nz = np.sqrt(np.clip(1.0 - rho2, 0.0, 1.0))
    ndl = np.clip(dx * light[0] + dy * light[1] + nz * light[2], -1.0, 1.0)
    wrap = np.clip((ndl + 0.35) / 1.35, 0.0, 1.0)             # wrapped diffuse: soft terminator
    shade = wrap ** 1.6
    bounce = 0.10 * smoothstep(0.35, 1.0, np.sqrt(rho2)) * (1.0 - ndl * 0.5 - 0.5)
    d = (np.sqrt(rho2) - 1.0) * R
    cov = c.coverage(d)
    return (shade + bounce).astype(F32), cov.astype(F32)


def _render(c: Canvas, mode: str, seed: int) -> np.ndarray:
    dark = mode == "dark"
    x, y = c.x, c.y
    L = np.array([-0.52, -0.62, 0.59], dtype=F32)
    L /= np.linalg.norm(L)

    # room: a broad vertical falloff with a faint light pool behind the spheres
    pool = np.exp(-(((x - 1.25) ** 2 + (y - 0.45) ** 2) / (2 * 0.75**2))).astype(F32)
    if dark:
        lo, hi = rgb("#0c0c0c"), rgb("#1f1f1e")
        bg = lo + (hi - lo) * (0.30 + 0.70 * pool)[..., None] * (0.55 + 0.45 * y)[..., None]
        sph_lo, sph_hi = rgb("#121212"), rgb("#a4a3a0")
        ring_col = rgb("#e8e6e3")
        red = rgb("#e94248")
    else:
        lo, hi = rgb("#dad8d4"), rgb("#ebe9e6")
        bg = lo + (hi - lo) * (0.35 + 0.65 * pool)[..., None]
        sph_lo, sph_hi = rgb("#bdbab5"), rgb("#f7f6f4")
        ring_col = rgb("#111111")
        red = rgb("#e2363d")

    img = bg.astype(F32)
    discs = [  # back to front: (cx, cy, R, brightness scale)
        (1.46, 0.66, 0.62, 0.58),
        (0.98, 0.36, 0.23, 0.92),
        (1.24, 0.56, 0.37, 1.0),
        (1.64, 0.98, 0.20, 0.85),
    ]
    sigma = 0.045 * c.h
    for cx, cy, R, bright in discs:
        shade, cov = _sphere(c, cx, cy, R, L)
        # cast shadow of this sphere onto everything painted so far (light comes from the upper left)
        sh = blur(_shift(cov, 0.060 * c.h, 0.085 * c.h), sigma)
        img *= (1.0 - (0.42 if dark else 0.26) * sh)[..., None]
        tone = sph_lo + (sph_hi - sph_lo) * (clamp01(shade) * bright)[..., None]
        img = img + (tone - img) * cov[..., None]

    # hairline ring around the main sphere with the single red dot parked on it
    cx, cy, R = 1.24, 0.56, 0.37
    rr = R * 1.34
    d = np.abs(np.sqrt((x - cx) ** 2 + (y - cy) ** 2) - rr) - 0.5 * c.ref(2.0)
    ring = c.coverage(d) * (0.38 if dark else 0.42)
    img = img + (ring_col - img) * ring[..., None]
    a = math.radians(34.0)
    bx, by = cx + rr * math.cos(a), cy + rr * math.sin(a)
    dd = np.sqrt((x - bx) ** 2 + (y - by) ** 2) - c.ref(15.0)
    img = img + (red - img) * c.coverage(dd)[..., None]
    return clamp01(img)


STYLES = [
    Style("soft-mono", "Matte Orbits", "soft monochrome gradient with grain", 9101,
          {"dark": "#e94248", "light": "#e2363d"}, _render, {"dark": 2.3, "light": 2.0}),
]

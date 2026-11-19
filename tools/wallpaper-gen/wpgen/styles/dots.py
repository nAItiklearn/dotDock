"""Halftone dot-matrix sphere: a lit sphere built from a square dot lattice, orbit ring and one red status dot."""
from __future__ import annotations

import math

import numpy as np

from ..core import F32, Canvas, clamp01, rgb, smoothstep
from ..registry import Style


def _lattice(c: Canvas, pitch_ref: float):
    """Pixel -> cell lookup for a square lattice of pitch ``pitch_ref`` (4K px), anchored at the centre."""
    p = pitch_ref * c.h / 2160.0
    xs = np.arange(c.w, dtype=F32) + 0.5
    ys = np.arange(c.h, dtype=F32) + 0.5
    ox = (c.w / 2.0) % p
    oy = (c.h / 2.0) % p
    ix = np.floor((xs - ox) / p).astype(np.int32)
    iy = np.floor((ys - oy) / p).astype(np.int32)
    fx = (xs - ox) - (ix + 0.5) * p
    fy = (ys - oy) - (iy + 0.5) * p
    # cell-centre positions in height units (for shading evaluated once per dot)
    cx = ((ix.min() + np.arange(ix.max() - ix.min() + 1) + 0.5) * p + ox) / c.h
    cy = ((iy.min() + np.arange(iy.max() - iy.min() + 1) + 0.5) * p + oy) / c.h
    return p, ix - ix.min(), iy - iy.min(), fx, fy, cx.astype(F32), cy.astype(F32)


def _render(c: Canvas, mode: str, seed: int) -> np.ndarray:
    p, ix, iy, fx, fy, cx, cy = _lattice(c, 24.0)
    X, Y = np.meshgrid(cx, cy)

    # sphere geometry (height units), lit from the lower left so the top-right corner stays dim
    sx, sy, R = 1.22, 0.50, 0.365
    dx, dy = (X - sx) / R, (Y - sy) / R
    rho = np.sqrt(dx * dx + dy * dy)
    nz = np.sqrt(np.clip(1.0 - rho**2, 0.0, 1.0))
    # dark: lit from the lower left; light (ink on paper): lit from the upper right. Either way the
    # dark side faces away from the top-right corner, which stays quiet for the widgets
    L = np.array([-0.56, 0.42, 0.72] if mode == "dark" else [0.50, -0.46, 0.73], dtype=F32)
    L /= np.linalg.norm(L)
    lam = np.clip(dx * L[0] + dy * L[1] + nz * L[2], 0.0, 1.0)
    inside = rho <= 1.0
    # slightly noisy terminator so the dot field reads as printed, not rendered
    rng = np.random.default_rng(seed)
    jitter = rng.normal(0, 0.012, lam.shape).astype(F32)

    r_max = 0.47 * p
    if mode == "dark":
        tone = np.clip(lam * 1.18 + 0.05 + jitter, 0, 1) ** 0.75
        r_sphere = r_max * (0.12 + 0.95 * tone) * (tone > 0.06)
    else:
        tone = np.clip(1.0 - lam + jitter, 0.10, 1)
        r_sphere = r_max * (0.16 + 0.84 * smoothstep(0.0, 1.0, tone) ** 0.9) * (tone > 0.025)
    r_cell = np.where(inside, r_sphere, 0.0).astype(F32)

    # orbit ring made of lattice dots just outside the sphere
    ring = (np.abs(rho - 1.19) < 0.5 * (p / c.h) / R * 1.05)
    r_cell = np.where(ring & ~inside, 0.30 * p, r_cell)
    # ambient field: every lattice site carries a very small dot
    ambient = 0.085 * p
    r_cell = np.maximum(r_cell, ambient).astype(F32)

    # pixel-space render
    r = r_cell[iy[:, None], ix[None, :]]
    dist = np.hypot(fx[None, :], fy[:, None])
    cov = np.clip(r - dist + 0.5, 0.0, 1.0)

    if mode == "dark":
        bg = rgb("#111111")
        yy, xx = c.y, c.x
        halo = 0.050 * np.exp(-(((xx - sx) ** 2 + (yy - sy) ** 2) / (2 * (R * 1.25) ** 2)))
        base = bg + (halo * 0.9)[..., None] * rgb("#e8e6e3")
        ink = rgb("#ecebe8")
        dim = rgb("#262625")
        # the ambient dots are dim; sphere dots are bright
        lit = clamp01((r - ambient * 1.4) / (0.35 * p))
        ink_c = dim + (ink - dim) * lit[..., None]
        img = base + (ink_c - base) * cov[..., None]
    else:
        base = rgb("#e8e6e3")
        yy, xx = c.y, c.x
        shade = 0.045 * np.exp(-(((xx - sx - 0.06) ** 2 + (yy - sy - 0.07) ** 2) / (2 * (R * 1.4) ** 2)))
        base = base - shade[..., None] * np.array([0.55, 0.55, 0.60], F32)
        ink = rgb("#161616")
        dim = rgb("#d2cfca")
        lit = clamp01((r - ambient * 1.4) / (0.35 * p))
        ink_c = dim + (ink - dim) * lit[..., None]
        img = base + (ink_c - base) * cov[..., None]

    # one red status dot, parked on the orbit
    ang = math.radians(41.0)
    bx, by = sx + 1.19 * R * math.cos(ang), sy + 1.19 * R * math.sin(ang)
    br = 0.50 * p
    d = np.sqrt((c.x - bx) ** 2 + (c.y - by) ** 2) * c.h - br
    red = rgb("#e94248" if mode == "dark" else "#e2363d")
    cv = np.clip(0.5 - d, 0, 1)
    # knock the lattice dot out under it, then paint it
    img = img * (1 - 0.0) + (red - img) * cv[..., None]
    return clamp01(img)


STYLES = [
    Style("dot-orb", "Halftone Orb", "halftone dot sphere", 5101,
          {"dark": "#e94248", "light": "#e2363d"}, _render, {"dark": 1.5, "light": 1.3}),
]

"""Procedural flower geometry shared by the bloom styles: petals, stems and a painter's-order bloom.

All shapes live in "height units". A bloom is evaluated at arbitrary points (a lattice of dot centres, or a
low-resolution pixel grid) and returns a brightness 0..1 plus the petal-local coordinates it was lit from.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .core import F32, smoothstep


@dataclass(frozen=True)
class Petal:
    angle: float      # direction of the petal axis in the flower frame (radians)
    length: float     # in flower radii
    width: float      # half-width at the broadest point, in flower radii
    bend: float       # sideways curl of the tip
    lit: float        # 0..1 how much light this petal catches
    phase: float      # decorrelates ruffles and veins between petals


def petal_halfwidth(t, wmax, tip=0.78, power=0.82):
    """Half-width along a petal: quick swell from the base, broadest near 40 %, pointed tip."""
    t = np.clip(t, 0.0, 1.0)
    return wmax * np.maximum(np.sin(np.pi * t**tip), 0.0) ** power


def make_whorl(rng, n, length, width, first, lit_range=(0.62, 1.0), spread=0.22):
    """``n`` petals evenly spread round the flower with some jitter in angle, length and curl."""
    out = []
    for i in range(n):
        out.append(Petal(
            angle=first + 2.0 * math.pi * i / n + rng.normal(0.0, spread * 2.0 * math.pi / n),
            length=length * rng.uniform(0.86, 1.08),
            width=width * rng.uniform(0.86, 1.12),
            bend=rng.normal(0.0, 0.30),
            lit=rng.uniform(*lit_range),
            phase=rng.uniform(0.0, 2.0 * math.pi),
        ))
    return out


def petal_shade(x, y, p: Petal, edge: float, tip: float = 0.78, power: float = 0.82, ribs: float = 0.15,
                rounded: float = 0.0):
    """Brightness (0..1), coverage (0..1) and halo (0..1, the soft ring just outside the petal) at points (x, y).

    ``x``/``y`` are in flower radii. ``edge`` is the anti-aliasing width of the petal edge in the same units;
    ``tip`` and ``power`` shape the outline (lower values give a rounder, blunter petal); ``ribs`` is the
    strength of the lengthwise veins; ``rounded`` closes a blunt tip with a circular cap over that last fraction
    of the petal.
    """
    ca, sa = math.cos(p.angle), math.sin(p.angle)
    u = (x * ca + y * sa) / p.length
    v = (-x * sa + y * ca) / p.length
    v = v - p.bend * u * u
    t = np.clip(u, 0.0, 1.0)
    w = petal_halfwidth(t, p.width / p.length, tip, power) * (1.0 + 0.07 * np.sin(2 * math.pi * (3.3 * t) + p.phase)
                                                   + 0.04 * np.sin(2 * math.pi * (7.1 * t) + 2.0 * p.phase))
    if rounded > 0.0:
        w = w * np.sqrt(np.clip(1.0 - np.clip((t - (1.0 - rounded)) / rounded, 0.0, 1.0) ** 2, 0.0, 1.0))
    w = np.maximum(w, 1e-4)
    vn = v / w
    inside_len = smoothstep(-0.02, 0.02, u) * smoothstep(1.03, 0.97, u)
    cover = np.clip(0.5 - (np.abs(v) - w) * p.length / max(edge, 1e-6), 0.0, 1.0) * inside_len
    halo = smoothstep(1.55, 1.0, np.abs(vn)) * smoothstep(-0.10, 0.08, u) * smoothstep(1.08, 0.92, u)

    base = 0.34 + 0.56 * smoothstep(0.04, 0.88, t) * (0.55 + 0.45 * p.lit)
    vein = ribs * np.cos(5.0 * math.pi * vn + p.phase) * smoothstep(0.08, 0.5, t)
    rim = 0.18 * smoothstep(0.55, 1.0, np.abs(vn)) * smoothstep(0.1, 0.5, t)
    midrib = 0.34 * np.exp(-((vn / 0.10) ** 2)) * (0.35 + 0.65 * (1.0 - t))
    throat = 0.62 * np.exp(-t / 0.10)
    tip_fade = 0.20 * smoothstep(0.92, 1.0, t)
    shade = np.clip(base + vein + rim - midrib - throat - tip_fade, 0.0, 1.0)
    return shade.astype(F32), cover.astype(F32), halo.astype(F32)


def stem_distance(x, y, pts):
    """Distance from points (x, y) to a polyline ``pts`` (N, 2), in the same units."""
    best = np.full(np.broadcast(x, y).shape, 9.0, dtype=F32)
    for i in range(len(pts) - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1][0] - ax, pts[i + 1][1] - ay
        l2 = bx * bx + by * by + 1e-12
        t = np.clip(((x - ax) * bx + (y - ay) * by) / l2, 0.0, 1.0)
        np.minimum(best, np.hypot(x - ax - t * bx, y - ay - t * by), out=best)
    return best


def bezier(p0, p1, p2, p3, n=48):
    t = np.linspace(0.0, 1.0, n)[:, None]
    p0, p1, p2, p3 = (np.asarray(p, dtype=F32) for p in (p0, p1, p2, p3))
    return ((1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t**3 * p3).astype(F32)

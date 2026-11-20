"""The hero landscape: misty ridges in a halftone screen, with an accent sun behind the far range.

Layers are painted far to near. Each has its own skyline, its own dot pitch (the screen gets coarser as
the ground comes closer) and a tone that is full at the crest and thins out downhill, so mist lies in
the folds. Where a nearer ridge covers a farther one the farther dots are removed, so the dots of each
ridge stay readable. The ink mask holds everything but the sun; the accent mask holds the sun, cut by
the same silhouettes so both can move as one piece.
"""
from __future__ import annotations

import math

import numpy as np

from .dots import F32, fbm, halftone, noise1d, smoothstep


def _alps(rng, w: int, peaks, sharp: float = 5.0, crag: float = 0.22) -> np.ndarray:
    """Peak height 0..1 per column: pyramids blended with a soft maximum, then eroded into crags."""
    u = (np.arange(w, dtype=F32) + 0.5) / w
    acc = np.zeros(w, dtype=F32)
    for xc, height, half in peaks:
        acc += (height * np.clip(1.0 - np.abs(u - xc) / half, 0.0, 1.0) ** 1.12) ** sharp
    prof = acc ** (1.0 / sharp)
    prof *= (1.0 - crag) + crag * (1.0 - np.abs(noise1d(rng, w, 14, 4, 0.55)))
    prof += 0.035 * (1.0 - np.abs(noise1d(rng, w, 90, 3, 0.62)) - 0.5) * (prof > 0.04)
    return np.clip(prof, 0.0, 1.0)


def _rolling(rng, w: int, cells: float, phase: float, waves: float) -> np.ndarray:
    """Gentle hills 0..1 per column."""
    u = (np.arange(w, dtype=F32) + 0.5) / w
    a = 0.55 * noise1d(rng, w, cells, 4, 0.5) + 0.45 * np.sin(2.0 * math.pi * (u * waves + phase))
    return np.clip(0.5 + 0.5 * a, 0.0, 1.0)


def _layer(rng, w: int, h: int, scale: float, line: np.ndarray, tone: float, pitch: float, fall: float,
           rim: float, face: float, streak_cells: float, angle: float, floor: float = 0.07):
    """Coverage and silhouette (both 0..1) of one ridge whose crest is ``line`` (rows / h, per column)."""
    y = ((np.arange(h, dtype=F32) + 0.5) / h)[:, None]
    d = y - line[None, :]
    inside = smoothstep(-0.6 / h, 0.6 / h, d)
    below = np.clip(d, 0.0, None)
    px = below * h
    p = pitch * scale
    body = floor + (1.0 - floor) * np.exp(-below / fall)
    edge = np.exp(-px / (1.5 * p))
    slope = np.gradient(line * h) * (1.0 if w == h else 1.0)
    slope = np.convolve(slope, np.ones(9, dtype=F32) / 9.0, mode="same")
    shade = 1.0 + face * np.clip(slope * 1.6, -1.0, 1.0)[None, :]
    streak = fbm(rng, w, h, streak_cells, 4, 0.55, stretch=0.30)
    streak = 0.78 + 0.22 * np.clip(streak, -1.5, 1.5) / 1.5
    mottle = 0.80 + 0.40 * smoothstep(-0.9, 0.9, fbm(rng, w, h, 3.0, 4, 0.55, stretch=2.2))
    t = tone * (body * shade * streak * mottle + rim * edge)
    t = np.clip(t, 0.0, 1.0) * inside
    cov = halftone(t.astype(F32), p, angle, rmax=0.56, gamma=0.55, floor=0.03)
    return cov, inside


def render_scape(width: int, height: int, scale: float, seed: int, narrow: bool = False) -> dict[str, np.ndarray]:
    """``width`` x ``height`` are CSS pixels; the arrays are ``scale`` times larger. Returns ink and accent coverage."""
    w, h = int(round(width * scale)), int(round(height * scale))
    rng = np.random.default_rng(seed)

    if narrow:
        far_peaks = ((0.30, 0.62, 0.40), (0.78, 0.50, 0.34))
        mid_peaks = ((0.62, 0.50, 0.46), (0.12, 0.34, 0.30))
    else:
        far_peaks = ((0.08, 0.80, 0.18), (0.20, 0.60, 0.15), (0.35, 0.30, 0.16), (0.62, 0.34, 0.14),
                     (0.80, 0.74, 0.20), (0.93, 0.95, 0.16))
        mid_peaks = ((0.04, 0.60, 0.20), (0.24, 0.30, 0.18), (0.70, 0.26, 0.20), (0.90, 0.62, 0.22))

    # (line, tone, pitch, fall, rim, face, streak cells, angle): far to near, rows as fractions of the height
    far = 0.36 - 0.30 * _alps(rng, w, far_peaks)
    mid = 0.45 - 0.23 * _alps(rng, w, mid_peaks, crag=0.30)
    r1 = 0.53 - 0.09 * _rolling(rng, w, 3, 0.10, 1.2)
    r2 = 0.65 - 0.10 * _rolling(rng, w, 4, 0.55, 1.6)
    r3 = 0.79 - 0.12 * _rolling(rng, w, 5, 0.30, 2.1)
    # the three near ridges get a fine serrated crest, like a tree line
    for k, ln in enumerate((r1, r2, r3)):
        ln += 0.0045 * (1.0 - np.abs(noise1d(rng, w, 160 + 40 * k, 3, 0.6)))
    specs = [
        (far, 0.42, 6.0, 0.13, 0.55, 0.60, 8.0, 45.0, 0.05),
        (mid, 0.52, 7.0, 0.11, 0.50, 0.55, 7.0, 45.0, 0.05),
        (r1, 0.60, 8.0, 0.075, 0.50, 0.25, 5.0, 45.0, 0.07),
        (r2, 0.70, 9.0, 0.07, 0.48, 0.20, 5.0, 45.0, 0.08),
        (r3, 0.82, 10.0, 0.08, 0.46, 0.18, 4.0, 45.0, 0.10),
    ]
    ink = np.zeros((h, w), dtype=F32)
    union = np.zeros((h, w), dtype=F32)
    for k, spec in enumerate(specs):
        cov, inside = _layer(rng, w, h, scale, *spec)
        ink = ink * (1.0 - inside) + cov * inside
        if k < 2:
            union = np.maximum(union, inside)

    # the sun: dense in the middle, thinning to a soft rim, hidden by the far ridges
    cx, cy, r = (0.71, 0.19, 0.056) if not narrow else (0.62, 0.17, 0.140)
    yy = ((np.arange(h, dtype=F32) + 0.5) / h)[:, None]
    xx = ((np.arange(w, dtype=F32) + 0.5) / w)[None, :]
    rho = np.hypot((xx - cx) * w, (yy - cy) * h) / (r * w)
    sun_tone = np.clip(1.0 - rho**2.6, 0.0, 1.0) * 0.98
    accent = halftone(sun_tone.astype(F32), 7.0 * scale, 45.0, rmax=0.56, gamma=0.6, floor=0.02) * (1.0 - union)
    return {"ink": ink.astype(F32), "accent": accent.astype(F32)}

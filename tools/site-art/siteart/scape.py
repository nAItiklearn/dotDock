"""The hero landscape: misty ridges and rolling meadow in a halftone screen.

Layers are painted far to near. Each has its own skyline, its own dot pitch (the screen gets coarser as
the ground comes closer) and a tone that is full at the crest and thins out downhill, so mist lies in
the folds. Where a nearer ridge covers a farther one the farther dots are removed, so the dots of each
ridge stay readable. The ridges are written to three colour masks (far, mid, near) so the page can paint
atmospheric perspective in three greens. The flowers that stand on this ground are a piece of their own
(bloom.py). The middle of the lower frame is left empty on the wide render: the screen of the hero stands
there and covers it, so drawing it would only cost bytes.
"""
from __future__ import annotations

import math

import numpy as np
from .dots import F32, fbm, halftone, noise1d, smoothstep

# Hero, wide render: the part of the frame the screen hides at every viewport width from 1240 px up,
# as (left, right, first row) fractions of the frame.
HERO_HIDDEN = (0.24, 0.76, 0.42)


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
    slope = np.gradient(line * h)
    slope = np.convolve(slope, np.ones(9, dtype=F32) / 9.0, mode="same")
    shade = 1.0 + face * np.clip(slope * 1.6, -1.0, 1.0)[None, :]
    streak = fbm(rng, w, h, streak_cells, 4, 0.55, stretch=0.30)
    streak = 0.78 + 0.22 * np.clip(streak, -1.5, 1.5) / 1.5
    mottle = 0.80 + 0.40 * smoothstep(-0.9, 0.9, fbm(rng, w, h, 3.0, 4, 0.55, stretch=2.2))
    t = tone * (body * shade * streak * mottle + rim * edge)
    t = np.clip(t, 0.0, 1.0) * inside
    cov = halftone(t.astype(F32), p, angle, rmax=0.56, gamma=0.55, floor=0.03)
    return cov, inside


def render_scape(width: int, height: int, scale: float, seed: int, narrow: bool = False,
                 hidden: tuple[float, float, float] | None = HERO_HIDDEN) -> dict[str, np.ndarray]:
    """``width`` x ``height`` are CSS pixels; the arrays are ``scale`` times larger."""
    w, h = int(round(width * scale)), int(round(height * scale))
    rng = np.random.default_rng(seed)

    if narrow:
        far_peaks = ((0.18, 0.55, 0.34), (0.78, 0.62, 0.34))
        mid_peaks = ((0.55, 0.45, 0.46), (0.05, 0.30, 0.26))
    else:
        far_peaks = ((0.06, 0.85, 0.17), (0.19, 0.60, 0.15), (0.36, 0.22, 0.16), (0.64, 0.24, 0.14),
                     (0.82, 0.74, 0.20), (0.94, 0.95, 0.16))
        mid_peaks = ((0.03, 0.62, 0.20), (0.25, 0.26, 0.18), (0.72, 0.22, 0.20), (0.92, 0.66, 0.22))

    far = 0.30 - 0.22 * _alps(rng, w, far_peaks)
    mid = 0.40 - 0.17 * _alps(rng, w, mid_peaks, crag=0.30)
    r1 = 0.50 - 0.07 * _rolling(rng, w, 3, 0.10, 1.2)
    r2 = 0.62 - 0.09 * _rolling(rng, w, 4, 0.55, 1.6)
    r3 = 0.78 - 0.10 * _rolling(rng, w, 5, 0.30, 2.1)
    for k, ln in enumerate((r1, r2, r3)):
        ln += 0.0040 * (1.0 - np.abs(noise1d(rng, w, 160 + 40 * k, 3, 0.6)))
    # (line, tone, pitch, fall, rim, face, streak cells, angle, floor, colour group)
    specs = [
        (far, 0.36, 6.0, 0.13, 0.40, 0.60, 8.0, 45.0, 0.04, "far"),
        (mid, 0.44, 7.0, 0.11, 0.38, 0.55, 7.0, 45.0, 0.04, "mid"),
        (r1, 0.52, 8.0, 0.075, 0.38, 0.25, 5.0, 45.0, 0.05, "mid"),
        (r2, 0.60, 9.0, 0.07, 0.36, 0.20, 5.0, 45.0, 0.06, "near"),
        (r3, 0.70, 10.0, 0.08, 0.34, 0.18, 4.0, 45.0, 0.08, "near"),
    ]
    groups = {g: np.zeros((h, w), dtype=F32) for g in ("far", "mid", "near")}
    for k, spec in enumerate(specs):
        group = spec[-1]
        cov, inside = _layer(rng, w, h, scale, *spec[:-1])
        for g in groups.values():
            g *= 1.0 - inside
        groups[group] += cov * inside

    if hidden is not None and not narrow:
        # A screen stands in front of the middle of the lower frame and covers it: nothing is drawn behind it.
        x0, x1, y0 = int(w * hidden[0]), int(w * hidden[1]), int(h * hidden[2])
        for g in groups.values():
            g[y0:, x0:x1] = 0.0
    return {k: v.astype(F32) for k, v in groups.items()}

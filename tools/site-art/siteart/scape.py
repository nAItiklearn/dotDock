"""The hero landscape: misty ridges and rolling meadow in a halftone screen, with a sun and wild flowers.

Layers are painted far to near. Each has its own skyline, its own dot pitch (the screen gets coarser as
the ground comes closer) and a tone that is full at the crest and thins out downhill, so mist lies in
the folds. Where a nearer ridge covers a farther one the farther dots are removed, so the dots of each
ridge stay readable. The ridges are written to three colour masks (far, mid, near) so the page can paint
atmospheric perspective in three greens; the sun and the flowers have masks of their own. All masks share
one frame and move as one piece.
"""
from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw

from .dots import F32, fbm, halftone, noise1d, smoothstep

SUPER = 4


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


def _flowers(rng, w: int, h: int, scale: float, crest: np.ndarray, count: int, centre_gap: float) -> tuple[np.ndarray, np.ndarray]:
    """Wild flowers on the near ground: five petal dots round a pale eye, bigger the nearer they are.

    ``crest`` is the row (0..1) where the flowered ground starts, per column. Flowers keep out of the
    middle of the frame (``centre_gap``), where the screen sits.
    """
    petals = Image.new("L", (w * SUPER, h * SUPER), 0)
    eyes = Image.new("L", (w * SUPER, h * SUPER), 0)
    dp, de = ImageDraw.Draw(petals), ImageDraw.Draw(eyes)
    s = SUPER
    placed = 0
    tries = 0
    while placed < count and tries < count * 40:
        tries += 1
        u = rng.uniform(0.0, 1.0)
        if abs(u - 0.5) < centre_gap:
            continue
        x = int(u * w)
        top = crest[min(w - 1, x)]
        v = rng.uniform(top + 0.02, 0.985)
        depth = (v - top) / max(1e-3, 1.0 - top)
        r = (2.1 + 5.4 * depth ** 1.2) * scale * rng.uniform(0.8, 1.2)
        cx, cy = x, v * h
        rot = rng.uniform(0, 2 * math.pi)
        for k in range(5):
            a = rot + 2 * math.pi * k / 5
            px, py = cx + math.cos(a) * r * 1.05, cy + math.sin(a) * r * 1.05
            pr = r * 0.62
            dp.ellipse(((px - pr) * s, (py - pr) * s, (px + pr) * s, (py + pr) * s), fill=255)
        er = r * 0.46
        de.ellipse(((cx - er) * s, (cy - er) * s, (cx + er) * s, (cy + er) * s), fill=255)
        placed += 1
    to = lambda im: np.asarray(im.resize((w, h), Image.Resampling.BOX), dtype=F32) / 255.0  # noqa: E731
    return to(petals), to(eyes)


def render_scape(width: int, height: int, scale: float, seed: int, narrow: bool = False) -> dict[str, np.ndarray]:
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
    union = np.zeros((h, w), dtype=F32)
    for k, spec in enumerate(specs):
        group = spec[-1]
        cov, inside = _layer(rng, w, h, scale, *spec[:-1])
        for g in groups.values():
            g *= 1.0 - inside
        groups[group] += cov * inside
        if k < 2:
            union = np.maximum(union, inside)

    # the sun: dense in the middle, thinning to a soft rim, hidden by the far ridges
    cx, cy, r = (0.865, 0.105, 0.045) if not narrow else (0.70, 0.22, 0.150)
    yy = ((np.arange(h, dtype=F32) + 0.5) / h)[:, None]
    xx = ((np.arange(w, dtype=F32) + 0.5) / w)[None, :]
    rho = np.hypot((xx - cx) * w, (yy - cy) * h) / (r * w)
    sun_tone = np.clip(1.0 - rho**2.6, 0.0, 1.0) * 0.98
    sun = halftone(sun_tone.astype(F32), 7.0 * scale, 45.0, rmax=0.56, gamma=0.6, floor=0.02) * (1.0 - union)

    # wild flowers on the two nearest hills, kept clear of the middle where the screen stands
    petals, eyes = _flowers(rng, w, h, scale, np.minimum(r2, r3), 150 if not narrow else 70, 0.0 if narrow else 0.20)
    return {k: v.astype(F32) for k, v in {**groups, "sun": sun, "flower": petals, "eye": eyes}.items()}

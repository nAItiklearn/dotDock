"""The footer horizon: low hills over a still lake, a moon and its reflection, reeds and a few birds.

Where the hero is a halftone screen, this one is engraved: parallel rows of beaded dots whose thickness
follows the tone. The ink mask holds hills, water, reeds and birds; the accent mask holds the moon and
the broken column of light it throws on the water.
"""
from __future__ import annotations

import math

import cv2
import numpy as np
from PIL import Image, ImageDraw

from .dots import F32, blur, engrave, fbm, halftone, noise1d, smoothstep
from .scape import _alps, _rolling

SUPER = 4


def _dotted_curve(draw: ImageDraw.ImageDraw, pts: np.ndarray, r0: float, r1: float, step: float, s: int) -> None:
    """Dots along a polyline, radius easing from r0 (first point) to r1 (last); everything in supersampled px."""
    seg = np.hypot(*np.diff(pts, axis=0).T)
    total = float(seg.sum())
    if total <= 0:
        return
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    for d in np.arange(0.0, total, step):
        i = int(np.searchsorted(cum, d, side="right") - 1)
        i = min(i, len(seg) - 1)
        f = (d - cum[i]) / max(seg[i], 1e-6)
        x, y = pts[i] + (pts[i + 1] - pts[i]) * f
        r = (r0 + (r1 - r0) * (d / total)) * s
        draw.ellipse((x * s - r, y * s - r, x * s + r, y * s + r), fill=255)


def _bezier(p0, p1, p2, n: int = 40) -> np.ndarray:
    t = np.linspace(0.0, 1.0, n)[:, None]
    return (1 - t) ** 2 * np.asarray(p0) + 2 * (1 - t) * t * np.asarray(p1) + t**2 * np.asarray(p2)


def _reeds_and_birds(rng, w: int, h: int, scale: float, narrow: bool) -> np.ndarray:
    big = Image.new("L", (w * SUPER, h * SUPER), 0)
    draw = ImageDraw.Draw(big)
    s = SUPER
    base_y = h * 0.985
    clusters = ((0.045, 0.085, 0.95), (0.955, 0.075, 1.0)) if not narrow else ((0.07, 0.12, 0.95), (0.93, 0.12, 1.0))
    for cx, spread, tallness in clusters:
        for _ in range(44):
            x0 = (cx + rng.normal(0.0, spread)) * w
            tall = h * tallness * rng.uniform(0.16, 0.50) * (1.0 - 0.8 * min(1.0, abs(x0 / w - cx) / (spread * 2.2)))
            lean = rng.normal(0.0, 0.10) * h + (0.04 * h if cx < 0.5 else -0.04 * h)
            top = np.array([x0 + lean, base_y - tall])
            mid = np.array([x0 + lean * 0.15, base_y - tall * 0.62])
            pts = _bezier((x0, base_y), mid, top)
            _dotted_curve(draw, pts, 2.3 * scale, 0.9 * scale, 3.1 * scale, s)
            if rng.random() < 0.20 and tall > 0.24 * h:                # a seed head on some stems
                head = _bezier(pts[-12], pts[-9], pts[-5], 8)
                _dotted_curve(draw, head, 3.3 * scale, 3.3 * scale, 2.2 * scale, s)
    # a few birds high in the sky: two beaded arcs each
    spots = ((0.70, 0.30, 1.0), (0.765, 0.24, 0.8), (0.81, 0.34, 0.7), (0.905, 0.27, 0.9)) if not narrow else \
            ((0.62, 0.30, 1.0), (0.80, 0.24, 0.8))
    for ux, vy, k in spots:
        x, y, span = ux * w, vy * h, 34.0 * scale * k
        for sgn in (-1, 1):
            tip = (x + sgn * span, y - span * 0.18)
            ctl = (x + sgn * span * 0.5, y - span * 0.34)
            _dotted_curve(draw, _bezier((x, y), ctl, tip, 16), 1.7 * scale, 0.9 * scale, 2.8 * scale, s)
    arr = np.asarray(big.resize((w, h), Image.Resampling.BOX), dtype=F32) / 255.0
    return arr


def render_horizon(width: int, height: int, scale: float, seed: int, narrow: bool = False) -> dict[str, np.ndarray]:
    w, h = int(round(width * scale)), int(round(height * scale))
    rng = np.random.default_rng(seed)
    v = ((np.arange(h, dtype=F32) + 0.5) / h)[:, None]
    u = ((np.arange(w, dtype=F32) + 0.5) / w)[None, :]
    water = 0.70

    far_peaks = ((0.12, 0.55, 0.20), (0.40, 0.38, 0.18), (0.63, 0.80, 0.22), (0.88, 0.50, 0.20)) if not narrow else \
                ((0.28, 0.60, 0.40), (0.80, 0.70, 0.36))
    far_line = (0.625 - 0.14 * _alps(rng, w, far_peaks, crag=0.28))[None, :]
    near_line = (0.672 - 0.040 * _rolling(rng, w, 4, 0.2, 1.4) + 0.004 * (1.0 - np.abs(noise1d(rng, w, 220, 3, 0.6))))[None, :]

    py, px = 6.0 * scale, 2.6 * scale
    streak = fbm(rng, w, h, 5.0, 4, 0.55, stretch=0.3)
    mottle = fbm(rng, w, h, 3.0, 4, 0.55, stretch=2.0)
    rows = (v - far_line) * h
    # far hills: light, a dense crest, misting out towards the lake
    far = np.clip(0.14 + 0.30 * np.exp(-np.clip(v - far_line, 0, None) / 0.06), 0, 1)
    far *= 0.82 + 0.18 * np.clip(streak, -1.5, 1.5) / 1.5
    far += 0.55 * np.exp(-np.clip(rows, 0, None) / (1.6 * py))
    far *= (1.0 - 0.55 * smoothstep(water - 0.07, water, v)) * smoothstep(-0.6, 0.6, rows)
    # near hills: darker, with trees as dense flecks along the crest
    in_near = smoothstep(-0.6 / h, 0.6 / h, v - near_line)
    trees = smoothstep(0.35, 0.8, fbm(rng, w, h, 70.0, 3, 0.6)) * np.exp(-np.clip(v - near_line, 0, None) / 0.03)
    near = np.clip(0.38 + 0.16 * mottle / 1.5 + 0.30 * trees + 0.5 * np.exp(-np.clip((v - near_line) * h, 0, None) / (1.4 * py)), 0, 1)
    near *= (1.0 - 0.45 * smoothstep(water - 0.02, water, v))
    land = np.clip(np.where(in_near > 0.5, near, far) * (v < water), 0.0, 1.0)

    # the lake: faint rows, ripples that stretch sideways, and the hills turned upside down
    ripple = fbm(rng, w, h, 14.0, 4, 0.55, stretch=14.0)
    refl_src = np.clip(2.0 * water - v, 0.0, 1.0)
    rows_idx = np.clip((refl_src * h).astype(np.int32), 0, h - 1)
    shift = (ripple[:, :] * 0.012 * w).astype(np.int32)
    cols = np.clip(np.arange(w)[None, :] + shift, 0, w - 1)
    mirrored = land[rows_idx[:, 0][:, None], cols]
    mirrored = blur(mirrored.astype(F32), 0.006 * h)
    depth = np.clip((v - water) / (1.0 - water), 0.0, 1.0)
    lake = (0.10 + 0.09 * np.clip(ripple, -1.5, 1.5) / 1.5 + 0.48 * mirrored * (1.0 - smoothstep(0.0, 0.50, depth))) * (v >= water)
    lake *= 1.0 - smoothstep(0.84, 1.0, v)
    shore = np.exp(-np.abs(v - water) * h / (1.2 * py)) * 0.5
    tone = np.clip(land + lake + shore, 0.0, 1.0)
    ink = engrave(tone.astype(F32), py, px, rmax=0.60, gamma=0.62, floor=0.025)
    ink = np.maximum(ink, _reeds_and_birds(rng, w, h, scale, narrow))

    # the moon, and the broken path of light it lays on the water
    mx, my, mr = (0.20, 0.52, 0.040) if not narrow else (0.26, 0.50, 0.110)
    rho = np.hypot((u - mx) * w, (v - my) * h) / (mr * w)
    moon_tone = np.clip(1.0 - rho**2.6, 0.0, 1.0) * 0.98 * (v < far_line + 0.012) * 0.0 + \
        np.clip(1.0 - rho**2.6, 0.0, 1.0) * 0.98
    moon_tone = moon_tone * (1.0 - smoothstep(-0.6 / h, 0.6 / h, v - far_line))   # the far ridge is in front of it
    moon = halftone(moon_tone.astype(F32), 6.0 * scale, 45.0, rmax=0.56, gamma=0.6, floor=0.02)
    spread = 0.022 * w * (1.0 + 1.6 * depth)
    path = np.exp(-(((u - mx) * w) / spread) ** 2) * (v >= water) * (1.0 - smoothstep(0.0, 0.85, depth))
    dashes = smoothstep(-0.30, 0.35, fbm(rng, w, h, 24.0, 3, 0.55, stretch=22.0))
    glow = engrave((path * dashes * 1.0).astype(F32), py, px, rmax=0.62, gamma=0.6, floor=0.03)
    return {"ink": np.clip(ink, 0, 1).astype(F32), "accent": np.clip(np.maximum(moon, glow), 0, 1).astype(F32)}

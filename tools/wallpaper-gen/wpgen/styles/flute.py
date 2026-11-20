"""Fluted glass flower: a violet anemone seen through vertical reeded glass on a quiet ground."""
from __future__ import annotations

import math
from dataclasses import replace

import numpy as np

from ..core import F32, Canvas, clamp01, fbm, lens_strips, ramp, remap_axis, rgb, smoothstep
from ..flora import bezier, make_whorl, petal_shade, stem_distance
from ..registry import Style

FLUTE_PITCH = 0.046          # width of one flute, in canvas heights
WINDOW = 2.2                 # how many flutes wide a slice of the scene each flute shows
CURVATURE = 0.50             # cubic term of the lens: stronger squeezing towards the flute edges
DISPERSION = (0.992, 1.0, 1.008)   # tiny colour fringing between the flute centre and its edge
SCENE_FACTOR = 2.0           # the scene is painted at 1/2 resolution; the glass then resamples it
FLOWER = (1.22, 0.56, 0.38)  # centre x, y and outer radius, in canvas heights
TILT = -0.20                 # the bloom is turned a little off the vertical
SQUASH = 0.88                # slight foreshortening of the bloom
EDGE_LINE_PX = 1.6           # width of the lit line at every flute edge, in 4K pixels


def _anemone(rng):
    outer = [replace(p, length=p.length * rng.uniform(0.82, 1.08)) for p in make_whorl(rng, 9, 1.00, 0.52, -1.45, lit_range=(0.55, 1.0), spread=0.28)]
    inner = [replace(p, length=p.length * rng.uniform(0.82, 1.08)) for p in make_whorl(rng, 7, 0.78, 0.36, -0.9, lit_range=(0.7, 1.0), spread=0.4)]
    # petals facing the light (lower left) catch more of it
    lit = lambda p: min(1.0, max(0.3, 0.5 + 0.5 * math.cos(p.angle - 2.2) + 0.15 * (p.lit - 0.8)))
    outer = [replace(p, lit=lit(p)) for p in outer]
    inner = [replace(p, lit=lit(p)) for p in inner]
    # back to front: petals pointing up are behind, petals pointing down lie over the others
    outer.sort(key=lambda p: math.sin(p.angle))
    inner.sort(key=lambda p: math.sin(p.angle))
    return outer + inner


def _palette(dark: bool):
    if dark:
        petal = [(0.0, "#0c0420"), (0.20, "#25106a"), (0.45, "#4d24c4"), (0.70, "#8d5ff0"), (0.90, "#cfa8ff"), (1.0, "#f3d0ff")]
        ground = ("#1a1720", "#25222d")
        stem = ("#243414", "#6b8434")
    else:
        petal = [(0.0, "#12062c"), (0.20, "#2a1280"), (0.45, "#4a24c0"), (0.70, "#8a5cdc"), (0.90, "#c9a2f2"), (1.0, "#eeccf4")]
        ground = ("#d4d5d7", "#e4e4e5")
        stem = ("#2a2a0e", "#4a4a1e")
    return petal, ground, stem


def _scene(c: Canvas, rng, dark: bool, x0_px: float, f: float) -> np.ndarray:
    """The picture behind the glass, on the low-res extended domain (height x width + margins)."""
    petal_ramp, ground, stem_cols = _palette(dark)
    wf = int(math.ceil((c.w + 2 * x0_px) / f))
    hf = int(math.ceil(c.h / f))
    xs = (((np.arange(wf, dtype=F32) + 0.5) * f - x0_px) / c.h)[None, :]
    ys = (((np.arange(hf, dtype=F32) + 0.5) * f) / c.h)[:, None]
    g0, g1 = rgb(ground[0]), rgb(ground[1])
    wash = (0.5 + 0.5 * np.exp(-(((xs - 1.0) ** 2) / 0.9 + ((ys - 0.4) ** 2) / 0.5))).astype(F32)
    img = (g0 + (g1 - g0) * wash[..., None]).astype(F32)

    cx, cy, R = FLOWER
    # stem: thick, dark olive, gently curved, running off the bottom of the frame
    stem = bezier((cx + 0.01, cy + 0.12), (cx + 0.05, cy + 0.42), (cx - 0.04, cy + 0.72), (cx + 0.015, 1.12), 40)
    d = stem_distance(xs, ys, stem)
    half = 0.021
    cov = np.clip(0.5 - (d - half) * c.h / f, 0.0, 1.0)
    across = np.clip((d / half), 0.0, 1.0)
    sc = ramp(0.25 + 0.55 * (1.0 - across), [(0.0, stem_cols[0]), (1.0, stem_cols[1])])
    img = img + (sc - img) * cov[..., None]

    # the bloom, painted only in its bounding box
    pad = 1.35
    xa, xb = max(0, int(((cx - pad * R) * c.h + x0_px) / f)), min(wf, int(((cx + pad * R) * c.h + x0_px) / f) + 1)
    ya, yb = max(0, int((cy - pad * R) * c.h / f)), min(hf, int((cy + pad * R) * c.h / f) + 1)
    dx = (xs[:, xa:xb] - cx) / R
    dy = (ys[ya:yb, :] - cy) / R
    ca, sa = math.cos(TILT), math.sin(TILT)
    px = dx * ca + dy * sa
    py = (-dx * sa + dy * ca) / SQUASH
    box = img[ya:yb, xa:xb]
    edge = 1.2 * f / c.h / R
    painted = np.zeros((yb - ya, xb - xa), dtype=F32)
    grain = fbm(rng, xb - xa, yb - ya, 6.0, 4)                      # brush-like unevenness in the petals
    for p in _anemone(rng):
        shade, cover, halo = petal_shade(px, py, p, edge, tip=0.60, power=0.52, ribs=0.045, rounded=0.30)
        col = ramp(np.clip(shade + 0.07 * grain, 0.0, 1.0), petal_ramp)
        box *= (1.0 - 0.55 * halo * (1.0 - cover) * painted)[..., None]      # petals shade the ones they overlap, not the ground
        box += (col - box) * cover[..., None]
        painted = np.maximum(painted, cover)
    # dark heart with a ring of pale stamens
    r = np.hypot(px, py)
    heart = smoothstep(0.17, 0.10, r)
    box += (rgb("#140a26" if not dark else "#07030f") - box) * heart[..., None]
    for k in range(64):
        a = 2.0 * math.pi * k / 64 + rng.normal(0.0, 0.03)
        rr = 0.20 + rng.normal(0.0, 0.012)
        sx, sy = rr * math.cos(a), rr * math.sin(a)
        dot = np.exp(-(((px - sx) ** 2 + (py - sy) ** 2) / (2 * 0.012**2)))
        tint = rgb("#e8d27a") if k % 9 == 0 else rgb("#8f8cc4")
        box += (tint - box) * (0.9 * dot)[..., None]
    img[ya:yb, xa:xb] = box
    return np.clip(img, 0.0, 1.0)


def _render(c: Canvas, mode: str, seed: int) -> np.ndarray:
    dark = mode == "dark"
    rng = np.random.default_rng(seed)
    W, H = c.w, c.h
    pitch = FLUTE_PITCH * H
    f = max(1.0, SCENE_FACTOR * H / 2160.0)
    x0 = WINDOW * 0.5 * pitch * (1 + CURVATURE) * 1.15 + 8
    scene = _scene(c, rng, dark, x0, f)

    centre, s, lens, cell = lens_strips(W, pitch, CURVATURE)
    jitter = (0.5 * np.sin(cell * 12.9898 + 4.1) + 0.5 * np.sin(cell * 7.233 + 1.3)).astype(F32)   # per-flute variation
    out = np.empty((H, W, 3), dtype=F32)
    for ch, d in enumerate(DISPERSION):
        src = centre + (1.0 + 0.05 * jitter) * WINDOW * 0.5 * pitch * lens * d
        out[..., ch] = remap_axis(np.ascontiguousarray(scene[..., ch]), src, W, H, f, x0, axis=1)

    # glass: each flute is a little lighter in the middle, darker at its edges, with a lit line on every edge
    body = 1.0 - (0.10 if dark else 0.07) * smoothstep(0.55, 1.0, np.abs(s))
    spec = np.exp(-(((s + 0.52) / 0.20) ** 2)) * (0.05 if dark else 0.035)
    line_w = EDGE_LINE_PX * H / 2160.0 / pitch * 2.0
    line = np.exp(-(((np.abs(s) - 1.0) / max(line_w, 0.02)) ** 2))
    shadow_line = np.exp(-(((np.abs(s) - 0.90) / max(line_w * 1.4, 0.03)) ** 2))
    flute_tone = 1.0 + 0.012 * jitter
    out *= (body * flute_tone)[None, :, None]
    out += spec[None, :, None] * (1.0 - out)
    out -= (0.10 if dark else 0.07) * shadow_line[None, :, None] * out
    out += ((0.42 if dark else 0.55) * line)[None, :, None] * (1.0 - out)
    return clamp01(out)


STYLES = [
    Style("flute-flower", "Reeded Violet", "fluted glass flower", 5501,
          {"dark": "#8d5ff0", "light": "#4a24c0"}, _render, {"dark": 1.7, "light": 1.4}),
]

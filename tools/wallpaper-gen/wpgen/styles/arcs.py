"""Neon scanline arcs: thick glowing circle segments on near-black with CRT banding.

Dark variants glow additively (tone-mapped so the tube core goes hot); light variants are
the print equivalent: solid inked arcs with a tinted halo on warm paper, banded by scanlines.
"""
from __future__ import annotations

import numpy as np

from ..core import F32, Canvas, clamp01, interest_mask, linear_to_srgb, rgb, smoothstep, srgb_to_linear
from ..registry import Style


def _scan(c: Canvas, depth: float, pitch_ref: float = 15.0):
    """Horizontal CRT banding: wide bright bands, narrow dark gaps. Returns (H,1) multiplier."""
    pitch = pitch_ref * c.h / 2160.0
    y = np.arange(c.h, dtype=F32) + 0.5
    ph = 0.5 + 0.5 * np.cos(2 * np.pi * y / pitch)
    gap = smoothstep(0.50, 1.0, ph)
    return (1.0 - depth * gap)[:, None]


class Arc:
    """A glowing circle segment. ``side`` = +1 fills the inside of the circle, -1 the outside."""

    def __init__(self, cx, cy, r, core, halo, fill_len, fill_gain, gain=1.0, side=1, span=None, fade=None,
                 bend=0.0, ambient=0.0):
        self.cx, self.cy, self.r = cx, cy, r
        self.core, self.halo = core, halo
        self.fill_len, self.fill_gain = fill_len, fill_gain
        self.gain, self.side, self.span, self.fade = gain, side, span, fade
        self.bend, self.ambient = bend, ambient


def _arc_field(c: Canvas, a: Arc, x, y):
    """Returns (core, glow, fill) intensity maps for one arc (all (H,W) float32)."""
    dx, dy = x - a.cx, y - a.cy
    rho = np.sqrt(dx * dx + dy * dy)
    d = rho - a.r                       # > 0 outside the circle
    th = None
    if a.bend or a.span:
        th = np.arctan2(dy, dx)
    w = a.core
    if a.bend:
        w = w * (1.0 + a.bend * np.sin(2.0 * th + 0.7))
    ad = np.abs(d)
    core = np.exp(-((d / w) ** 2))
    # tube: flat-ish shoulders, then a soft two-scale halo
    shoulder = 1.0 - smoothstep(w * 0.9, w * 1.9, ad)
    core = np.maximum(core, 0.85 * shoulder)
    glow = 0.55 * np.exp(-ad / a.halo) + 0.20 * np.exp(-ad / (a.halo * 3.2))
    depth = np.clip(-d * a.side, 0, None)
    onside = smoothstep(-w * 0.6, w * 0.8, -d * a.side)
    fill = (a.fill_gain * np.exp(-depth / a.fill_len) + a.ambient) * onside
    f = 1.0
    if a.span:
        c0, hw, soft = a.span
        dth = np.abs(np.angle(np.exp(1j * (th - c0))))
        f = 1.0 - smoothstep(hw - soft, hw, dth)
    if a.fade is not None:
        f = f * a.fade(x, y)
    return (core * f * a.gain).astype(F32), (glow * f * a.gain).astype(F32), (fill * f).astype(F32)


def _render_neon(c: Canvas, mode: str, seed: int, arcs: list[Arc], hue: dict, bg_glow: list) -> np.ndarray:
    rng = np.random.default_rng(seed)
    x, y = c.x, c.y
    calm = interest_mask(c, left=(0.26, 0.58), corner=(0.62, 0.90), corner_v=(0.45, 0.05), floor=0.0)
    core_t = np.zeros((c.h, c.w), F32)
    glow_t = np.zeros((c.h, c.w), F32)
    fill_t = np.zeros((c.h, c.w), F32)
    for a in arcs:
        co, gl, fi = _arc_field(c, a, x, y)
        core_t += co
        glow_t += gl
        fill_t += fi
    # soft ambient pools of colour (broad blobs), like the lit areas of a phosphor screen
    for (bx, by, sx, sy, amp) in bg_glow:
        fill_t += amp * np.exp(-0.5 * (((x - bx) / sx) ** 2 + ((y - by) / sy) ** 2)).astype(F32)

    if mode == "dark":
        acc = srgb_to_linear(rgb(hue["dark"]))
        heat = srgb_to_linear(rgb(hue["heat"]))
        # the far-left stays quiet: it attenuates the glow, not the geometry of the arcs themselves
        att = (0.10 + 0.90 * calm).astype(F32)
        cal_c = (0.25 + 0.75 * calm).astype(F32)
        lin = acc * ((1.15 * glow_t + 0.95 * fill_t) * att)[..., None]
        lin += acc * (1.8 * core_t * cal_c)[..., None]
        lin += heat * ((core_t ** 2.2) * 1.5 * cal_c)[..., None]
        lin = lin * _scan(c, 0.52)[..., None]
        base = srgb_to_linear(rgb("#0b0b0c"))
        img = 1.0 - np.exp(-lin * 1.35) + base
        img = linear_to_srgb(img)
        return clamp01(img)

    # light: warm paper + ink
    paper = rgb("#e8e6e3")
    ink = rgb(hue["light"])
    cov = clamp01(core_t * 1.25)
    halo = clamp01((0.85 * glow_t + 0.80 * fill_t) * (0.12 + 0.88 * calm))
    img = paper + (rgb(hue["tint"]) - paper) * halo[..., None]
    img = img * (1.0 - 0.10 * smoothstep(0.0, 1.0, halo))[..., None]
    img = img + (ink - img) * smoothstep(0.30, 0.78, cov)[..., None] * (0.35 + 0.65 * calm)[..., None] \
        if False else img + (ink - img) * smoothstep(0.16, 0.55, cov)[..., None]
    img *= _scan(c, 0.075)[..., None] * (1.0 - 0.18 * cov * _scan(c, 1.0))[..., None]
    return clamp01(img)


# ---------------------------------------------------------------------------
# compositions
# ---------------------------------------------------------------------------
def _fade_corner(c: Canvas, left=(0.28, 0.62)):
    m = interest_mask(c, left=left, corner=(0.60, 0.90), corner_v=(0.50, 0.04), floor=0.0)
    return lambda x, y: m


def _render_red(c: Canvas, mode: str, seed: int) -> np.ndarray:
    fd = _fade_corner(c)
    ox, oy = 2.05, 1.30
    arcs = [
        Arc(ox, oy, 0.80, 0.020, 0.030, 0.20, 1.15, gain=1.0, side=1, ambient=0.10, bend=0.10, fade=fd),
        Arc(ox, oy, 1.10, 0.0075, 0.020, 0.10, 0.0, gain=0.55, side=1, fade=fd),
        Arc(ox, oy, 1.46, 0.014, 0.026, 0.20, 0.0, gain=0.72, side=1, fade=fd),
    ]
    hue = {"dark": "#e8352d", "heat": "#ffb15a", "light": "#e2363d", "tint": "#f2b8ae"}
    return _render_neon(c, mode, seed, arcs, hue, [])


def _render_cyan(c: Canvas, mode: str, seed: int) -> np.ndarray:
    fd = _fade_corner(c, left=(0.30, 0.55))
    arcs = [
        Arc(1.36, 0.67, 0.34, 0.017, 0.026, 0.14, 0.80, gain=1.0, side=1, ambient=0.18, fade=fd),
        Arc(1.36, 0.67, 0.58, 0.0085, 0.022, 0.10, 0.0, gain=0.70, side=1, span=(1.9, 1.75, 0.8), fade=fd),
        Arc(1.36, 0.67, 0.84, 0.012, 0.024, 0.10, 0.0, gain=0.50, side=1, span=(0.55, 1.15, 0.7), fade=fd),
    ]
    hue = {"dark": "#17c9d3", "heat": "#c9fbff", "light": "#0f9aa6", "tint": "#a9dbdc"}
    return _render_neon(c, mode, seed, arcs, hue, [])


STYLES = [
    Style("arc-red", "Phosphor Red", "neon scanline arcs", 3101,
          {"dark": "#e2362f", "light": "#e2363d"}, _render_red, {"dark": 1.3, "light": 1.5}),
    Style("arc-cyan", "Phosphor Cyan", "neon scanline arcs", 3202,
          {"dark": "#17c9d3", "light": "#0f9aa6"}, _render_cyan, {"dark": 1.3, "light": 1.5}),
]

"""Fluted-glass louvers: rows of cylindrical lenses refracting a soft field behind them.

* ``louver-ember``  vertical flutes over blobs of red and black (a frosted red sun in the light variant)
* ``louver-silver`` horizontal brushed-metal slats catching a studio strip light
"""
from __future__ import annotations

import math

import cv2
import numpy as np

from ..core import (F32, Canvas, blur_xy, clamp01, eval_waves_pointwise, make_waves, ramp, rgb, smoothstep)
from ..registry import Style


def _blob(x, y, cx, cy, sx, sy, rot=0.0):
    dx, dy = x - cx, y - cy
    if rot:
        c, s = math.cos(rot), math.sin(rot)
        dx, dy = dx * c + dy * s, -dx * s + dy * c
    return np.exp(-0.5 * ((dx / sx) ** 2 + (dy / sy) ** 2)).astype(F32)


def _warp(rng, x, y, amount, k=(0.6, 1.8), n=7):
    wv = make_waves(rng, n, k[0], k[1], slope=0.6)
    wy = make_waves(rng, n, k[0], k[1], slope=0.6)
    return x + amount * eval_waves_pointwise(x, y, wv), y + amount * eval_waves_pointwise(x, y, wy)


def _lens(n_px: int, pitch_px: float, curv: float):
    """Per-column lens coordinates for a row of cylindrical flutes."""
    p = np.arange(n_px, dtype=F32) + 0.5
    cell = np.floor(p / pitch_px)
    s = (p / pitch_px - cell) * 2.0 - 1.0
    centre = (cell + 0.5) * pitch_px
    return centre.astype(F32), s.astype(F32), (s + curv * s**3).astype(F32), cell.astype(F32)


def _remap_axis(field: np.ndarray, src: np.ndarray, out_w: int, out_h: int, f: float, origin_px: float, axis: int):
    """Sample ``field`` (low-res, extended by origin_px) at per-column (axis=1) or per-row (axis=0) source coordinates."""
    if axis == 1:  # src has length out_w: source x per column, y is identity
        fx = ((src + origin_px) / f - 0.5).astype(F32)
        fy = ((np.arange(out_h, dtype=F32) + 0.5) / f - 0.5).astype(F32)
        mx = np.ascontiguousarray(np.broadcast_to(fx[None, :], (out_h, out_w)))
        my = np.ascontiguousarray(np.broadcast_to(fy[:, None], (out_h, out_w)))
    else:  # src has length out_h: source y per row
        fy = ((src + origin_px) / f - 0.5).astype(F32)
        fx = ((np.arange(out_w, dtype=F32) + 0.5) / f - 0.5).astype(F32)
        mx = np.ascontiguousarray(np.broadcast_to(fx[None, :], (out_h, out_w)))
        my = np.ascontiguousarray(np.broadcast_to(fy[:, None], (out_h, out_w)))
    return cv2.remap(field, mx, my, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)


# ---------------------------------------------------------------------------
# louver-ember
# ---------------------------------------------------------------------------
def _ember_fields(c: Canvas, rng, mode, x0_px, f):
    """Scalar fields (tone, accent) on the extended low-res domain."""
    wf = int(math.ceil((c.w + 2 * x0_px) / f))
    hf = int(math.ceil(c.h / f))
    xs = (((np.arange(wf, dtype=F32) + 0.5) * f - x0_px) / c.h)[None, :]
    ys = (((np.arange(hf, dtype=F32) + 0.5) * f) / c.h)[:, None]
    x, y = _warp(rng, xs, ys, 0.10, (0.5, 1.4))
    a = c.aspect
    u = x / a
    mask = smoothstep(0.30, 0.58, u)  # keeps the left ~40 % dark / quiet
    corner = 1.0 - smoothstep(0.52, 0.80, u) * smoothstep(0.62, 0.10, y)

    if mode == "dark":
        s = 0.40 * mask + 0.12
        s += 0.75 * _blob(x, y, 1.12, 0.06, 0.30, 0.22)          # hot upper glow
        s += 0.60 * _blob(x, y, 0.95, 1.04, 0.50, 0.16)          # lit lower rim
        s += 0.30 * _blob(x, y, 1.62, 0.80, 0.22, 0.28)
        s += 0.20 * _blob(x, y, 1.45, 0.45, 0.30, 0.20)
        # a dark wave crossing the middle (string of dark blobs)
        for i in range(9):
            t = i / 8.0
            cx = 0.60 + t * 1.45
            cy = 0.62 - 0.08 * math.sin(t * 5.2 + 0.4) + 0.06 * t
            s -= 0.40 * _blob(x, y, cx, cy, 0.17, 0.065)
        s -= 0.55 * _blob(x, y, 1.84, 1.04, 0.26, 0.22)           # black lower-right
        s -= 0.30 * _blob(x, y, 1.66, 0.22, 0.16, 0.15)
        s = s * (0.10 + 0.90 * corner)                         # the top-right corner stays dim for the widgets
        return np.clip(s, 0.0, 1.25), None
    # light: tone = warm frosted glass with soft grey shadows, accent = one red sun behind it
    t = 0.80 + 0.12 * _blob(x, y, 0.55, 0.22, 0.50, 0.35)
    t -= 0.26 * _blob(x, y, 1.55, 1.00, 0.50, 0.22)
    t -= 0.16 * _blob(x, y, 0.85, 1.05, 0.35, 0.14)
    for i in range(7):
        k = i / 6.0
        t -= 0.10 * _blob(x, y, 0.80 + k * 1.1, 0.76 - 0.06 * math.sin(k * 4.8 + 0.8), 0.20, 0.07)
    acc = 1.10 * _blob(x, y, 1.20, 0.50, 0.30, 0.34) * (0.45 + 0.55 * mask)
    acc += 0.55 * _blob(x, y, 1.66, 0.84, 0.15, 0.13)
    acc += 0.40 * _blob(x, y, 1.0, 0.98, 0.30, 0.10)
    return np.clip(t, 0, 1.2), np.clip(acc, 0, 1.3)


def render_ember(c: Canvas, mode: str, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    W, H = c.w, c.h
    pitch = H * 0.0392
    m = 6.5                       # window size shown by each flute, in flute widths
    curv = 0.45
    f = 2.0 * max(1.0, H / 2160.0)
    f = max(f, 1.0)
    x0 = m * 0.5 * pitch * (1 + curv) * 1.15 + 8
    centre, s, lens, cell = _lens(W, pitch, curv)

    t_f, a_f = _ember_fields(c, rng, mode, x0, f)
    chans = []
    disp = (0.985, 1.0, 1.02)          # tiny chromatic dispersion between flute edge and centre
    for d in disp:
        src = centre + m * 0.5 * pitch * lens * d
        chans.append(_remap_axis(t_f, src, W, H, f, x0, axis=1))
    a_chans = None
    if a_f is not None:
        a_chans = [_remap_axis(a_f, centre + m * 0.5 * pitch * lens * d, W, H, f, x0, axis=1) for d in disp]

    out = np.empty((H, W, 3), dtype=F32)
    if mode == "dark":
        stops = [(0.00, "#050203"), (0.16, "#1d0508"), (0.36, "#6a0a14"), (0.58, "#d02a33"), (0.70, "#e94248"),
                 (0.88, "#f47a55"), (1.05, "#ffb792"), (1.25, "#fff1e2")]
        for ch in range(3):
            out[..., ch] = ramp(chans[ch], stops)[..., ch]
        lum = chans[1]
    else:
        base = [(0.0, "#bdb8b2"), (0.45, "#dedad5"), (0.80, "#efedea"), (1.0, "#f8f6f3")]
        red_edge = rgb("#e2363d")
        for ch in range(3):
            tone = ramp(chans[ch], base)
            al = smoothstep(0.03, 0.55, a_chans[ch])[..., None]
            core = ramp(a_chans[ch], [(0.0, "#f6d9d4"), (0.30, "#f3a09a"), (0.62, "#e84c4e"), (0.85, "#e2363d"), (1.3, "#bf2630")])
            out[..., ch] = (tone + (core - tone) * al)[..., ch]
        lum = chans[1] * 0.6 + 0.4

    # glass: dark seam where two flutes meet, a soft specular sliver on the lit side of each flute
    calm_x = (0.35 + 0.65 * smoothstep(0.28, 0.62, (np.arange(W, dtype=F32) + 0.5) / W))
    seam = smoothstep(0.90, 1.0, np.abs(s)) * (0.50 if mode == "dark" else 0.16) * calm_x
    spec = np.exp(-(((s + 0.58) / 0.17) ** 2)) * 0.5
    gain = (1.0 - seam)[None, :, None]
    out *= gain
    if mode == "dark":
        sp = (spec[None, :] * smoothstep(0.30, 1.0, lum) * 0.30)[..., None]
        out += sp * rgb("#ffe0d0")
    else:
        frost = 1.0 - 0.06 * (0.5 + 0.5 * s)
        out *= frost[None, :, None]
        glint = np.exp(-(((s + 0.86) / 0.07) ** 2)) * 0.45 * calm_x
        out = out + glint[None, :, None] * (1.0 - out)
    return clamp01(out)


# ---------------------------------------------------------------------------
# louver-silver: horizontal brushed-metal slats, the same lens idea turned on its side
# ---------------------------------------------------------------------------
def _band(x, y, x0, y0, ang, width, curve=0.0, k=2.2):
    """Soft line through (x0, y0) at angle ``ang`` with a gentle bend; gaussian across, ``width`` in height units."""
    ca, sa = math.cos(ang), math.sin(ang)
    dx, dy = x - x0, y - y0
    along = dx * ca + dy * sa
    across = -dx * sa + dy * ca + curve * np.sin(along * k)
    return np.exp(-((across / width) ** 2)).astype(F32)


def _silver_light_field(c: Canvas, rng, mode, y0_px, f):
    wf = int(math.ceil(c.w / f))
    hf = int(math.ceil((c.h + 2 * y0_px) / f))
    xs = (((np.arange(wf, dtype=F32) + 0.5) * f) / c.h)[None, :]
    ys = (((np.arange(hf, dtype=F32) + 0.5) * f - y0_px) / c.h)[:, None]
    u = xs / c.aspect
    mask = smoothstep(0.28, 0.62, u) * (1.0 - 0.75 * smoothstep(0.72, 0.98, u) * smoothstep(0.45, 0.05, ys))
    wv = make_waves(rng, 6, 0.4, 1.1, slope=0.8)
    xw = xs + 0.05 * eval_waves_pointwise(xs, ys, wv)
    yw = ys + 0.05 * eval_waves_pointwise(ys, xs, wv)
    # three crossing sheen lines (a broad one, a sharp one, a faint wide one)
    g = 0.55 * _band(xw, yw, 1.28, 0.40, 0.62, 0.060, 0.02) + 0.95 * _band(xw, yw, 1.30, 0.41, 0.62, 0.0065, 0.02)
    g += 0.40 * _band(xw, yw, 1.62, 0.74, -0.52, 0.090, 0.03) + 0.70 * _band(xw, yw, 1.64, 0.745, -0.52, 0.0055, 0.03)
    g += 0.30 * _band(xw, yw, 1.0, 0.95, -0.15, 0.20, 0.0)
    return (g * mask).astype(F32)


def render_silver(c: Canvas, mode: str, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    W, H = c.w, c.h
    n_slats = 19.0
    pitch = H / n_slats
    m, curv = 3.2, 0.25
    f = max(1.0, 2.0 * H / 2160.0)
    y0 = m * 0.5 * pitch * (1 + curv) * 1.15 + 8

    centre, s, lens, _cell = _lens(H, pitch, curv)
    g_f = _silver_light_field(c, rng, mode, y0, f)
    src = centre + m * 0.5 * pitch * lens
    g = _remap_axis(g_f, src, W, H, f, y0, axis=0)

    # brushed grain: very fine streaks along the slats, a little stronger where it catches light
    nn = rng.standard_normal((H // 2, W // 2)).astype(F32)
    nn = blur_xy(nn, 22.0 * (W / 3840), 0.55)
    nn /= nn.std() + 1e-6
    nn = cv2.resize(nn, (W, H), interpolation=cv2.INTER_CUBIC)

    if mode == "dark":
        gl = 0.20 + 0.20 * smoothstep(0.25, 0.85, c.u) * (1.0 - 0.95 * smoothstep(0.66, 0.95, c.u) * smoothstep(0.50, 0.08, c.v)) + g * 1.0
        gl = gl * (1.0 + nn * (0.016 + 0.03 * clamp01(g)))
        stops = [(0.0, "#070708"), (0.14, "#141518"), (0.30, "#2b2c30"), (0.55, "#7a7c80"), (0.80, "#cbcdd0"),
                 (1.0, "#f3f2f0"), (1.3, "#ffffff")]
        # each slat is lit from above and shades towards its lower lip
        profile = 1.0 - 0.55 * smoothstep(0.15, 1.0, s)
    else:
        gl = 0.62 + g * 0.55 - 0.22 * (1.0 - clamp01(g * 1.6)) * (0.35 + 0.65 * (smoothstep(0.2, 0.7, c.u)))
        gl = gl * (1.0 + nn * (0.012 + 0.025 * clamp01(g)))
        stops = [(0.0, "#6c6e72"), (0.30, "#9fa1a4"), (0.55, "#d0d1d3"), (0.85, "#f0efed"), (1.1, "#ffffff")]
        profile = 1.0 - 0.34 * smoothstep(0.15, 1.0, s)
    col = ramp(gl, stops)
    col *= profile[:, None, None]
    # slat edges: dark lap line on the lower lip, thin lit lip on the upper edge
    gap = smoothstep(0.93, 1.0, s) * (0.65 if mode == "dark" else 0.26)
    col *= (1.0 - gap)[:, None, None]
    lip = np.exp(-(((s + 0.94) / 0.05) ** 2)) * (0.16 if mode == "dark" else 0.22)
    col += lip[:, None, None] * (1.0 - col)
    return clamp01(col)


STYLES = [
    Style("louver-ember", "Ember Flutes", "fluted-glass louvers", 1101,
          {"dark": "#e94248", "light": "#e2363d"}, render_ember, {"dark": 1.7, "light": 1.5}),
    Style("louver-silver", "Brushed Blinds", "brushed-metal louvers", 1202,
          {"dark": "#c9ccd0", "light": "#a9abae"}, render_silver, {"dark": 1.6, "light": 1.4}),
]

"""Fluted-glass louvers: rows of cylindrical lenses refracting a soft field behind them.

* ``louver-ember``  vertical flutes over blobs of red and black (a frosted red sun in the light variant)
* ``louver-silver`` horizontal brushed-metal slats catching a studio strip light
"""
from __future__ import annotations

import math

import cv2
import numpy as np

from ..core import (F32, Canvas, blur_xy, clamp01, eval_waves_pointwise, lens_strips, make_waves, ramp, remap_axis, rgb,
                    smoothstep)
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
    centre, s, lens, cell = lens_strips(W, pitch, curv)

    t_f, a_f = _ember_fields(c, rng, mode, x0, f)
    chans = []
    disp = (0.985, 1.0, 1.02)          # tiny chromatic dispersion between flute edge and centre
    for d in disp:
        src = centre + m * 0.5 * pitch * lens * d
        chans.append(remap_axis(t_f, src, W, H, f, x0, axis=1))
    a_chans = None
    if a_f is not None:
        a_chans = [remap_axis(a_f, centre + m * 0.5 * pitch * lens * d, W, H, f, x0, axis=1) for d in disp]

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
# louver-silver: horizontal brushed-chrome slats over a folded, creased sheet of light
# ---------------------------------------------------------------------------
SLATS = 27                 # slats over the canvas height
SLAT_WINDOW = 0.9          # how much of a slat's height each slat refracts (in slats)
BRUSH_STREAK_PX = (30.0, 0.55)   # brushed grain: streak length and thickness in 4K reference pixels


def _gauss(d, w):
    return np.exp(-((d / w) ** 2)).astype(F32)


def _curve_arc(x, y, x0, slope, bend, y_from, y_to, width, fade):
    """Thin light arc x(y) = x0 + slope*y + bend*y^2, gaussian across, fading in/out over ``fade`` of the canvas height."""
    xc = x0 + slope * y + bend * y * y
    dxdy = slope + 2.0 * bend * y
    d = (x - xc) / np.sqrt(1.0 + dxdy * dxdy)
    return _gauss(d, width) * smoothstep(y_from, y_from + fade, y) * smoothstep(y_to, y_to - fade, y)


def _crease_frame(x, y, vx, vy, up_left_slope, up_right_slope):
    """Signed distances to the two arms of the V-shaped crease; positive inside (above) the fold."""
    n1 = np.array([up_left_slope, -1.0], dtype=F32)
    n1 /= np.linalg.norm(n1)
    n2 = np.array([-up_right_slope, -1.0], dtype=F32)
    n2 /= np.linalg.norm(n2)
    return (n1[0] * (x - vx) + n1[1] * (y - vy)).astype(F32), (n2[0] * (x - vx) + n2[1] * (y - vy)).astype(F32)


def render_silver(c: Canvas, mode: str, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    W, H = c.w, c.h
    dark = mode == "dark"
    pitch = H / SLATS
    rows = np.arange(H, dtype=F32) + 0.5
    cell = np.floor(rows / pitch)
    s = (rows / pitch - cell) * 2.0 - 1.0                    # -1 at a slat's top lip, +1 at its lower seam
    lens = s + 0.25 * s**3
    y_eff = ((cell + 0.5 + SLAT_WINDOW * 0.5 * lens) * pitch / H)[:, None]
    x = c.x
    a = c.aspect
    quiet = 0.25 + 0.75 * smoothstep(0.28, 0.62, x / a)      # the clock side keeps the folds faint
    corner = smoothstep(0.52, 0.80, x / a) * smoothstep(0.50, 0.12, c.y)   # and so does the widget corner

    # a large V-shaped crease: lighter sheet above it, darker below, a faint lit lip on the fold itself
    wv = make_waves(rng, 6, 0.4, 1.1, slope=0.8)
    xw = x + 0.014 * eval_waves_pointwise(x, y_eff, wv)
    s1, s2 = _crease_frame(xw, y_eff, 0.86, 0.70, 0.62, 0.74)
    m = np.minimum(s1, s2)
    inside = smoothstep(-0.035, 0.075, m)
    lip = _gauss(m, 0.005)
    shadow = _gauss(m + 0.06, 0.07) * (1.0 - inside)
    # broad studio light pool behind the sheet and a darker floor
    pool = _gauss(x - 1.15, 0.65) * _gauss(y_eff - 0.12, 0.55)
    # thin bright arcs sweeping across the slats, drawn in true pixel space so they cross the lips smoothly
    y = c.y
    arc1 = _curve_arc(x, y, 0.70, 0.98, -0.62, 0.03, 0.93, 0.0030, 0.14)
    arc2 = _curve_arc(x, y, 1.30, 0.74, -0.30, 0.28, 1.02, 0.0030, 0.14)
    haze = 0.20 * _curve_arc(x, y, 0.70, 0.98, -0.62, 0.03, 0.93, 0.020, 0.20) + 0.08 * _curve_arc(x, y, 0.70, 0.98, -0.62, 0.03, 0.93, 0.085, 0.25)
    haze += 0.44 * _curve_arc(x, y, 1.36, 0.74, -0.30, 0.28, 1.02, 0.12, 0.25)

    gate = 1.0 - smoothstep(0.72, 1.0, np.abs(s))            # arcs dim into the seams between slats
    glint = (1.00 * arc1 + 0.45 * arc2) * (0.55 + 0.45 * gate)[:, None] * (0.20 + 0.80 * quiet)

    # brushed grain: very fine horizontal streaks that catch a little more light where the sheet is lit
    nn = rng.standard_normal((H // 2, W // 2)).astype(F32)
    nn = blur_xy(nn, BRUSH_STREAK_PX[0] * W / 3840.0, BRUSH_STREAK_PX[1])
    nn /= nn.std() + 1e-6
    nn = cv2.resize(nn, (W, H), interpolation=cv2.INTER_CUBIC)

    if dark:
        tone = 0.24 + 0.28 * inside + 0.34 * pool * (0.35 + 0.65 * inside) - 0.10 * shadow
        tone += 0.14 * smoothstep(0.0, 1.0, x / a) * (1.0 - y) * inside
        tone = tone * (0.46 + 0.54 * quiet) + haze * quiet + 0.16 * lip * quiet + glint
        tone *= 1.0 - 0.62 * corner
        tone *= 1.0 + nn * (0.024 + 0.030 * clamp01(tone))
        stops = [(0.0, "#050506"), (0.12, "#111214"), (0.30, "#26272a"), (0.52, "#5a5c60"), (0.74, "#a4a6aa"),
                 (0.92, "#e2e3e4"), (1.06, "#ffffff")]
        profile = 0.40 + 0.60 * _gauss(s + 0.45, 0.66)       # lit upper body, shaded lower lip
        seam_dark, lip_lit = 0.86, 0.20
    else:
        tone = 0.40 + 0.26 * inside + 0.18 * pool * (0.35 + 0.65 * inside) - 0.12 * shadow
        tone -= 0.12 * smoothstep(0.3, 1.0, y) * (1.0 - inside)
        tone = 0.72 + (tone - 0.72) * (0.30 + 0.70 * quiet) * (1.0 - 0.6 * corner) + 0.6 * haze * quiet + 0.06 * lip * quiet + 0.80 * glint
        tone *= 1.0 + nn * (0.014 + 0.020 * clamp01(tone))
        stops = [(0.0, "#4c4e52"), (0.26, "#7e8084"), (0.48, "#b2b4b7"), (0.70, "#d9dadb"), (0.88, "#f0efed"),
                 (1.05, "#ffffff")]
        profile = 0.72 + 0.28 * _gauss(s + 0.45, 0.66)
        seam_dark, lip_lit = 0.26, 0.32
    col = ramp(tone, stops)
    col *= profile[:, None, None]
    # slat edges: a dark lap line on the lower lip, a thin lit lip on the upper edge
    seam = smoothstep(0.74, 1.0, s) * seam_dark
    col *= (1.0 - seam)[:, None, None]
    lit = _gauss(s + 0.95, 0.06) * lip_lit
    col += lit[:, None, None] * (1.0 - col)
    return clamp01(col)


STYLES = [
    Style("louver-ember", "Ember Flutes", "fluted-glass louvers", 1101,
          {"dark": "#e94248", "light": "#e2363d"}, render_ember, {"dark": 1.7, "light": 1.5}),
    Style("louver-silver", "Brushed Blinds", "brushed-metal louvers", 1202,
          {"dark": "#c9ccd0", "light": "#a9abae"}, render_silver, {"dark": 1.6, "light": 1.4}),
]

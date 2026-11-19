"""Halftone landscape: snowy range and rolling green hills under a slate sky, seen through a coarse dot screen."""
from __future__ import annotations

import math

import cv2
import numpy as np

from ..core import F32, Canvas, blur, clamp01, disc_cover, fbm, ramp, rgb, smoothstep, upscale
from ..registry import Style

SCREEN_PITCH_REF = 36.0      # halftone cell size in 4K pixels
SCREEN_ANGLE = math.radians(45.0)
DOT_MAX = 0.74               # largest dot radius, in half-pitches of the cell diagonal (>= 0.70 merges into a solid)
SCENE_FACTOR = 2             # the scene behind the screen is painted at 1/2 resolution
RANGE_PEAK_X = 1.22          # where the highest summit stands, in canvas heights
HILL_LAYERS = ((0.640, 0.045), (0.730, 0.060), (0.850, 0.070), (0.960, 0.060))   # (mean horizon, undulation)


def _noise1d(rng, n, cells, octaves=5, gain=0.55):
    """Smooth 1-D fractal noise of length ``n`` with unit-ish amplitude (cells = first-octave lattice size)."""
    out = np.zeros(n, dtype=F32)
    amp = 1.0
    for o in range(octaves):
        k = max(2, int(cells * 2**o))
        knots = rng.standard_normal((1, k)).astype(F32)
        out += amp * cv2.resize(knots, (n, 1), interpolation=cv2.INTER_CUBIC)[0]
        amp *= gain
    return out / (np.abs(out).max() + 1e-6)


def _scene(c: Canvas, rng, dark: bool) -> np.ndarray:
    w, h = c.w // SCENE_FACTOR, c.h // SCENE_FACTOR
    a = c.aspect
    xs = ((np.arange(w, dtype=F32) + 0.5) / h)[None, :]
    ys = ((np.arange(h, dtype=F32) + 0.5) / h)[:, None]

    if dark:
        sky_stops = [(0.0, "#0a1422"), (0.45, "#18304a"), (0.62, "#2c4a66"), (0.80, "#4a6a86"), (1.0, "#7a95a8")]
        cloud_col, snow_lit, snow_shade, rock = "#7f9db6", "#e9e4d6", "#4a627f", "#2b3342"
        haze = "#5e7b92"
        hill_far, hill_mid, hill_near, tree = "#2a4a3a", "#2d5a2a", "#244c1d", "#14301c"
        hill_light = "#7aa346"
        mist = 0.30
    else:
        sky_stops = [(0.0, "#55789a"), (0.45, "#7497b0"), (0.62, "#93b1c4"), (0.80, "#bccfd8"), (1.0, "#dbe5e6")]
        cloud_col, snow_lit, snow_shade, rock = "#f1f5f7", "#fff6e2", "#8497b4", "#586278"
        haze = "#c8d6dd"
        hill_far, hill_mid, hill_near, tree = "#9fb98a", "#7fa84c", "#62923a", "#1f4624"
        hill_light = "#bcd47a"
        mist = 0.26

    # sky: a graded dome with horizontal cloud banks drifting in from the left
    t = np.clip(ys / 0.66, 0.0, 1.0)
    img = ramp(np.broadcast_to(t, (h, w)).copy(), sky_stops).astype(F32)
    cl = fbm(rng, w, h, 3.0, 5, 0.55, stretch=3.2)
    banks = smoothstep(-0.20, 0.75, cl) * (smoothstep(0.62, 0.05, ys) * 0.75 + 0.25 * smoothstep(0.7, 0.35, xs / a))
    banks *= 0.35 + 0.65 * smoothstep(1.10, 0.15, xs)
    img += (rgb(cloud_col) - img) * ((0.55 if dark else 0.80) * banks)[..., None]

    # a pale far range behind the main one, for depth
    far_env = 0.115 * np.exp(-(((xs[0] - 0.95) / 0.55) ** 2)) + 0.07 * np.exp(-(((xs[0] - 1.75) / 0.30) ** 2)) + 0.03
    far_line = 0.610 - far_env * (0.72 + 0.28 * (1.0 - np.abs(_noise1d(rng, w, 11, 5, 0.6)))) - 0.012 * _noise1d(rng, w, 6, 4)
    far_mask = smoothstep(-0.003, 0.003, ys - far_line[None, :])
    img += (rgb(haze) * 0.55 + rgb(sky_stops[-2][1]) * 0.45 - img) * (0.78 * far_mask)[..., None]

    # the range: one great summit and lower shoulders; ridged noise carves the faces, light falls from the left
    crag = 1.0 - np.abs(_noise1d(rng, w, 8, 4, 0.55))
    env = (0.215 * np.exp(-(((xs[0] - RANGE_PEAK_X) / 0.30) ** 2)) + 0.115 * np.exp(-(((xs[0] - 0.84) / 0.24) ** 2))
           + 0.085 * np.exp(-(((xs[0] - 1.68) / 0.26) ** 2)) + 0.045)
    ridge = (0.625 - env * (0.66 + 0.34 * crag) - 0.010 * _noise1d(rng, w, 8, 5))[None, :]
    below = smoothstep(-0.0025, 0.0025, ys - ridge)
    depth = np.clip((ys - ridge) / 0.17, 0.0, 1.0)
    # a lit height field: the summit envelope, ridged noise for arêtes and gullies, shaded from the upper left
    arete = 1.0 - np.abs(fbm(rng, w, h, 6.0, 5, 0.50, stretch=0.70))
    elevation = blur(env[None, :] * (1.0 - 0.25 * depth) * (0.30 + 0.70 * arete), 1.2)
    gx, gy = np.gradient(elevation, axis=1), np.gradient(elevation, axis=0)
    steep = np.hypot(gx, gy)
    norm = 1.0 / (np.percentile(steep, 97) + 1e-9)
    facet = clamp01(0.52 - 0.34 * norm * (0.85 * gx + 0.50 * gy))
    rock_mix = smoothstep(0.55, 1.05, steep * norm) * smoothstep(0.05, 0.60, depth + 0.15) * smoothstep(0.10, 0.26, env)[None, :]
    snow = rgb(snow_shade) + (rgb(snow_lit) - rgb(snow_shade)) * facet[..., None]
    mount = snow + (rgb(rock) - snow) * (0.75 * rock_mix)[..., None]
    shaded = rgb(snow_shade) * 0.80
    mount += (shaded - mount) * (0.60 * (1.0 - smoothstep(0.12, 0.62, xs / a)))[..., None]   # the clock side of the range sits in shade
    mount += (rgb(haze) - mount) * (smoothstep(0.45, 1.0, depth) * mist)[..., None]
    img += (mount - img) * below[..., None]

    # a band of mist where the range meets the hills
    veil = np.exp(-(((ys - 0.665) / 0.030) ** 2)) * (0.55 + 0.35 * fbm(rng, w, h, 4.0, 3, 0.5, stretch=3.0))
    img += (rgb(haze) - img) * (0.70 * clamp01(veil))[..., None]

    # rolling hills, far to near; each lit from the left and dotted with tree clumps
    lights = np.linspace(0.0, 1.0, len(HILL_LAYERS))
    for k, (y0, amp) in enumerate(HILL_LAYERS):
        near = lights[k]
        line = y0 - amp * (0.55 * _noise1d(rng, w, 3 + k, 4, 0.5) + 0.45 * np.sin(2 * np.pi * (xs[0] / a * (1.1 + 0.5 * k) + 0.3 * k)))
        inside = smoothstep(-0.003, 0.003, ys - line[None, :])
        body = blur(fbm(rng, w, h, 2.5 + k, 3, 0.40), 3.0)
        slope = (np.gradient(line) * h * 1.6)[None, :]                        # the ridge line's own tilt shades the whole hill
        base = ramp(np.full((h, w), near, dtype=F32), [(0.0, hill_far), (0.5, hill_mid), (1.0, hill_near)])
        shade = clamp01(0.55 + 0.9 * slope + 0.16 * body - 0.22 * (ys - line[None, :]))      # lit from the left
        col = base + (rgb(hill_light) - base) * (0.80 * shade * (0.35 + 0.65 * near))[..., None]
        speckle = smoothstep(0.30, 0.85, fbm(rng, w, h, 110.0 + 40 * k, 2, 0.6))
        valley = smoothstep(0.05, 0.75, -body)
        groves = smoothstep(0.50, 0.85, fbm(rng, w, h, 7.0 + 2 * k, 4, 0.5, stretch=0.6))
        col += (rgb(tree) - col) * (0.26 * speckle * (0.3 + 0.7 * near) + 0.60 * valley * near**1.1 + 0.50 * groves * near)[..., None]
        fade = smoothstep(0.0, 0.10 + 0.04 * (1 - near), ys - line[None, :])      # mist clings to each ridge line
        col += (rgb(haze) - col) * ((1.0 - fade) * (0.55 - 0.35 * near))[..., None]
        img += (col - img) * inside[..., None]
    return clamp01(upscale(img, c.w, c.h))


def _screen(c: Canvas, scene: np.ndarray, dark: bool) -> np.ndarray:
    """Halftone overlay: returns the composited image. Ink dots grow in the shadows, pale dots in the lights."""
    p = SCREEN_PITCH_REF * c.h / 2160.0
    ca, sa = math.cos(SCREEN_ANGLE), math.sin(SCREEN_ANGLE)
    xs = np.arange(c.w, dtype=F32) + 0.5
    ys = np.arange(c.h, dtype=F32) + 0.5
    # lattice indices cover the rotated canvas
    corners = np.array([[0, 0], [c.w, 0], [0, c.h], [c.w, c.h]], dtype=F32)
    uu = corners[:, 0] * ca + corners[:, 1] * sa
    vv = -corners[:, 0] * sa + corners[:, 1] * ca
    i0, i1 = int(math.floor(uu.min() / p)) - 1, int(math.ceil(uu.max() / p)) + 1
    j0, j1 = int(math.floor(vv.min() / p)) - 1, int(math.ceil(vv.max() / p)) + 1
    ci = (np.arange(i0, i1 + 1, dtype=F32) + 0.5) * p
    cj = (np.arange(j0, j1 + 1, dtype=F32) + 0.5) * p
    CU, CV = np.meshgrid(ci, cj)
    cx = CU * ca - CV * sa
    cy = CU * sa + CV * ca

    lum = scene @ np.array([0.2126, 0.7152, 0.0722], dtype=F32)
    soft = blur(lum, 0.45 * p)
    L = cv2.remap(soft, cx.astype(F32), cy.astype(F32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

    calm = 0.40 + 0.60 * smoothstep(0.18, 0.55, np.clip(cx / c.w, 0.0, 1.0))      # the clock side gets a gentler screen
    half_diag = 0.5 * p * math.sqrt(2.0)
    if dark:
        ink_r = smoothstep(0.30, 0.05, L)
        pale_r = 0.26 + 0.74 * smoothstep(0.16, 0.74, L)
    else:
        ink_r = smoothstep(0.56, 0.20, L)
        pale_r = 0.26 + 0.74 * smoothstep(0.40, 0.90, L)
    ink_r = (ink_r * calm).astype(F32)
    pale_r = (pale_r * calm).astype(F32)

    u = xs[None, :] * ca + ys[:, None] * sa
    v = -xs[None, :] * sa + ys[:, None] * ca
    ii = np.floor(u / p).astype(np.int32) - i0
    jj = np.floor(v / p).astype(np.int32) - j0
    fu = u - (ii + i0 + 0.5) * p
    fv = v - (jj + j0 + 0.5) * p
    dist = np.hypot(fu, fv)
    r_ink = ink_r[jj, ii] * half_diag * DOT_MAX * 0.80
    r_pale = pale_r[jj, ii] * half_diag * DOT_MAX * 0.62
    cov_ink = disc_cover(r_ink, dist) * (r_ink > 0.0)
    cov_pale = disc_cover(r_pale, dist) * (r_pale > 0.0)

    if dark:
        ink, pale = rgb("#070b1c"), rgb("#dfe8f6")
        k_ink, k_pale = 0.92, 0.72
    else:
        ink, pale = rgb("#2d3f66"), rgb("#ffffff")
        k_ink, k_pale = 0.80, 0.80
    corner = smoothstep(0.66, 0.90, c.u) * smoothstep(0.42, 0.08, c.v)
    veil = (0.14 + 0.86 * smoothstep(0.18, 0.60, c.u)) * (1.0 - 0.80 * corner)    # the widget zones keep a faint screen only
    img = scene + (ink - scene) * (k_ink * veil * cov_ink)[..., None]
    img = img + (pale - img) * (k_pale * veil * cov_pale)[..., None]
    return clamp01(img)


def _render(c: Canvas, mode: str, seed: int) -> np.ndarray:
    dark = mode == "dark"
    rng = np.random.default_rng(seed)
    scene = _scene(c, rng, dark)
    # the half-resolution scene gets its surface grain and crisp edges back at full resolution
    grain = fbm(rng, c.w, c.h, 240.0, 3, 0.55)
    scene = scene * (1.0 + 0.022 * grain)[..., None]
    scene = scene + 0.6 * (scene - blur(scene, 0.0009 * c.h * 2.0))
    return _screen(c, clamp01(scene), dark)


STYLES = [
    Style("halftone-ridge", "Screen Ridge", "halftone landscape", 5601,
          {"dark": "#7aa346", "light": "#2d3f66"}, _render, {"dark": 1.8, "light": 1.5}),
]

"""Halftone landscape: a snowy range and layered green hills under a slate sky, seen through a coarse dot screen."""
from __future__ import annotations

import math

import cv2
import numpy as np

from ..core import F32, Canvas, blur, clamp01, disc_cover, fbm, ramp, rgb, smoothstep, upscale
from ..registry import Style

SCREEN_PITCH_REF = 40.0      # halftone cell size in 4K pixels
SCREEN_ANGLE = math.radians(45.0)
SCENE_FACTOR = 2             # sky and hill colours are painted at 1/2 resolution; edges and the range at full resolution
RANGE_BASE_Y = 0.628         # canvas height at which the range meets the mist
RANGE_PEAKS = ((1.22, 0.205, 0.36), (1.53, 0.150, 0.28), (0.96, 0.125, 0.30), (0.62, 0.078, 0.26),
               (1.77, 0.118, 0.26), (0.26, 0.040, 0.30))         # (x, height, half-width) in canvas heights
FAR_PEAKS = ((0.90, 0.115, 0.50), (1.62, 0.090, 0.34), (0.35, 0.050, 0.34))
BAND_TOP, BAND_BOTTOM = 0.32, 0.70   # rows of the full-resolution range painting, in canvas heights
SUN = np.array([-0.62, -0.36, 0.70], dtype=F32)   # direction to the light: upper left, in front
HILL_LAYERS = ((0.652, 0.040), (0.740, 0.056), (0.855, 0.066), (0.965, 0.058))   # (mean horizon, undulation)


def _noise1d(rng, n, cells, octaves=5, gain=0.55):
    """Smooth 1-D fractal noise of length ``n`` scaled to |value| <= 1 (cells = first-octave lattice size)."""
    out = np.zeros(n, dtype=F32)
    amp = 1.0
    for o in range(octaves):
        k = max(2, int(cells * 2**o))
        knots = rng.standard_normal((1, k)).astype(F32)
        out += amp * cv2.resize(knots, (n, 1), interpolation=cv2.INTER_CUBIC)[0]
        amp *= gain
    return out / (np.abs(out).max() + 1e-6)


def _peaks(x, peaks, base, sharp=6.0):
    """Skyline of pyramid peaks blended with a soft maximum; ``peaks`` are (x, height, half-width)."""
    acc = np.zeros_like(x)
    for xc, height, half in peaks:
        acc += (height * np.clip(1.0 - np.abs(x - xc) / half, 0.0, 1.0) ** 1.1) ** sharp
    return acc ** (1.0 / sharp) + base


def _palette(dark: bool) -> dict:
    if dark:
        return dict(
            sky=[(0.0, "#0a1422"), (0.45, "#18304a"), (0.62, "#2c4a66"), (0.80, "#4a6a86"), (1.0, "#7a95a8")],
            cloud="#7f9db6", cloud_gain=0.50, snow_lit="#f3ecd9", snow_shade="#506a8c", rock="#2c3444", rock_lit="#76706a",
            haze="#5e7b92", far="#46627c", mist=0.30,
            hills=[(0.0, "#3d5f58"), (0.35, "#2f6032"), (0.7, "#28561f"), (1.0, "#1b4219")], hill_light="#86ad4a",
            tree="#0f2a18", calm_dim=0.52)
    return dict(
        sky=[(0.0, "#55789a"), (0.45, "#7497b0"), (0.62, "#93b1c4"), (0.80, "#bccfd8"), (1.0, "#dbe5e6")],
        cloud="#f1f5f7", cloud_gain=0.80, snow_lit="#fff7e4", snow_shade="#7f93b2", rock="#4d5870", rock_lit="#a69f94",
        haze="#c8d6dd", far="#b4c6d2", mist=0.26,
        hills=[(0.0, "#9db892"), (0.35, "#79a44e"), (0.7, "#568d30"), (1.0, "#3c7226")], hill_light="#c4dc84",
        tree="#1d4a24", calm_dim=0.0)


def _sky(c: Canvas, rng, pal) -> np.ndarray:
    """Sky dome, clouds drifting in from the left, and a pale far range, at half resolution."""
    w, h = c.w // SCENE_FACTOR, c.h // SCENE_FACTOR
    a = c.aspect
    xs = ((np.arange(w, dtype=F32) + 0.5) / h)[None, :]
    ys = ((np.arange(h, dtype=F32) + 0.5) / h)[:, None]
    t = np.clip(ys / 0.66, 0.0, 1.0)
    img = ramp(np.broadcast_to(t, (h, w)).copy(), pal["sky"]).astype(F32)
    cl = fbm(rng, w, h, 3.0, 5, 0.55, stretch=3.2)
    banks = smoothstep(-0.20, 0.75, cl) * (smoothstep(0.62, 0.05, ys) * 0.75 + 0.25 * smoothstep(0.7, 0.35, xs / a))
    banks *= 0.35 + 0.65 * smoothstep(1.10, 0.15, xs)
    img += (rgb(pal["cloud"]) - img) * (pal["cloud_gain"] * banks)[..., None]

    far_e = _peaks(xs[0], FAR_PEAKS, 0.028, 5.0)
    far_e = far_e * (0.76 + 0.24 * (1.0 - np.abs(_noise1d(rng, w, 12, 5, 0.6))))
    far_line = (RANGE_BASE_Y - 0.010 - far_e)[None, :]
    far = smoothstep(-0.003, 0.003, ys - far_line)
    shade = 0.5 + 0.5 * np.clip((ys - far_line) / 0.05, 0.0, 1.0)
    far_col = rgb(pal["far"]) * (1.04 - 0.10 * shade[..., None])
    img += (far_col - img) * (0.82 * far)[..., None]
    return img


def _range(c: Canvas, rng, pal) -> tuple[np.ndarray, np.ndarray, int]:
    """The snowy range at full resolution: (colour band, alpha band, first row). Snow lies on gentle faces, rock on steep."""
    W, H = c.w, c.h
    r0, r1 = int(BAND_TOP * H), int(BAND_BOTTOM * H)
    hb = r1 - r0
    x1 = (np.arange(W, dtype=F32) + 0.5) / H
    yb = ((np.arange(r0, r1, dtype=F32) + 0.5) / H)[:, None]

    # silhouette: pyramid summits, eroded by ridged noise at two scales so the crest reads as crags
    env = _peaks(x1, RANGE_PEAKS, 0.040)
    crag_lo = 1.0 - np.abs(_noise1d(rng, W, 14, 4, 0.55))
    crag_hi = 1.0 - np.abs(_noise1d(rng, W, 90, 3, 0.62))
    env_lo = env * (0.80 + 0.20 * crag_lo)
    fine = 0.0075 * (crag_hi - 0.5) * (env > 0.07)           # crest serration: it must not be extruded down the faces
    env = env_lo + fine
    ridge = (RANGE_BASE_Y - env)[None, :]
    depth = np.clip((yb - ridge) / 0.21, 0.0, 1.0)

    # height field: the pyramid skyline falls away downwards; ridged noise running downslope carves arêtes and couloirs
    arete = np.exp(-0.9 * np.abs(fbm(rng, W, hb, 3.2, 6, 0.50, stretch=0.38)))
    carve = smoothstep(0.26, 0.50, x1 / c.aspect)[None, :]        # calmer faces on the clock side
    crest = env_lo[None, :] + fine[None, :] * (1.0 - depth) ** 3
    height = blur(crest * (1.0 - 0.45 * depth) * (0.80 + 0.20 * carve * arete), 1.1 * H / 2160.0)
    gx = np.gradient(height, axis=1) * H
    gy = np.gradient(height, axis=0) * H
    nx, ny = -1.5 * gx, -1.5 * gy
    lam = (nx * SUN[0] + ny * SUN[1] + SUN[2]) / np.sqrt(1.0 + nx * nx + ny * ny)
    lit = smoothstep(0.30, 0.88, lam)
    slope = np.hypot(gx, 0.6 * gy)
    snow = smoothstep(1.05, 0.45, slope) * (0.45 + 0.55 * smoothstep(0.0, 0.55, 1.0 - depth))

    snow_c = rgb(pal["snow_shade"]) + (rgb(pal["snow_lit"]) - rgb(pal["snow_shade"])) * lit[..., None]
    rock_c = rgb(pal["rock"]) + (rgb(pal["rock_lit"]) - rgb(pal["rock"])) * lit[..., None]
    mount = rock_c + (snow_c - rock_c) * snow[..., None]
    mount += (rgb(pal["haze"]) - mount) * (smoothstep(0.30, 1.0, depth) * pal["mist"] * 1.7)[..., None]
    distant = 0.78 * (1.0 - smoothstep(0.18, 0.52, x1 / c.aspect))[None, :]      # the left of the range recedes into haze
    mount += (rgb(pal["far"]) * (0.90 + 0.10 * lit[..., None]) - mount) * distant[..., None]
    alpha = smoothstep(-0.0012, 0.0012, yb - ridge)
    return mount.astype(F32), np.broadcast_to(alpha, (hb, W)).astype(F32), r0


def _hill_colour(c: Canvas, rng, pal, k: int, line: np.ndarray, near: float) -> np.ndarray:
    """Half-resolution colour of hill layer ``k``: lit from the left, tree groves in the hollows."""
    w, h = c.w // SCENE_FACTOR, c.h // SCENE_FACTOR
    ys = ((np.arange(h, dtype=F32) + 0.5) / h)[:, None]
    body = blur(fbm(rng, w, h, 2.5 + k, 3, 0.40), 3.0)
    slope = (np.gradient(line) * h * 1.6)[None, :]                        # the ridge line's own tilt shades the whole hill
    base = ramp(np.full((h, w), near, dtype=F32), pal["hills"])
    shade = clamp01(0.55 + 0.9 * slope + 0.16 * body - 0.22 * (ys - line[None, :]))
    col = base + (rgb(pal["hill_light"]) - base) * (0.80 * shade * (0.35 + 0.65 * near))[..., None]
    speckle = smoothstep(0.30, 0.85, fbm(rng, w, h, 110.0 + 40 * k, 2, 0.6))
    valley = smoothstep(0.05, 0.75, -body)
    groves = smoothstep(0.50, 0.85, fbm(rng, w, h, 7.0 + 2 * k, 4, 0.5, stretch=0.6))
    left = 0.30 + 0.70 * smoothstep(0.18, 0.60, (np.arange(w, dtype=F32) + 0.5) / h / c.aspect)[None, :]   # fewer dark groves on the clock side
    col += (rgb(pal["tree"]) - col) * ((0.22 * speckle * (0.3 + 0.7 * near) + 0.65 * valley * near**1.1 + 0.55 * groves * near) * left)[..., None]
    fade = smoothstep(0.0, 0.10 + 0.04 * (1 - near), ys - line[None, :])      # mist clings to each ridge line
    col += (rgb(pal["haze"]) - col) * ((1.0 - fade) * (0.60 - 0.40 * near))[..., None]
    return col


def _scene(c: Canvas, rng, dark: bool) -> np.ndarray:
    W, H = c.w, c.h
    pal = _palette(dark)
    img = upscale(_sky(c, rng, pal), W, H)
    x1 = (np.arange(W, dtype=F32) + 0.5) / H
    y1 = ((np.arange(H, dtype=F32) + 0.5) / H)[:, None]

    band, alpha, r0 = _range(c, rng, pal)
    img[r0 : r0 + band.shape[0]] += (band - img[r0 : r0 + band.shape[0]]) * alpha[..., None]

    # mist where the range meets the hills
    ys_h = ((np.arange(H // SCENE_FACTOR, dtype=F32) + 0.5) / (H // SCENE_FACTOR))[:, None]
    veil = np.exp(-(((ys_h - 0.664) / 0.024) ** 2)) * smoothstep(-0.5, 0.9, fbm(rng, W // SCENE_FACTOR, H // SCENE_FACTOR, 4.0, 3, 0.5, stretch=3.0))
    img += (rgb(pal["haze"]) - img) * (0.46 * upscale(clamp01(veil), W, H))[..., None]

    # layered hill silhouettes, far to near, each a step darker and more saturated, with a contact shadow on the one behind
    xs_h = ((np.arange(W // SCENE_FACTOR, dtype=F32) + 0.5) / (H // SCENE_FACTOR))
    for k, (y0, amp) in enumerate(HILL_LAYERS):
        near = k / (len(HILL_LAYERS) - 1)
        line_h = y0 - amp * (0.55 * _noise1d(rng, W // SCENE_FACTOR, 3 + k, 4, 0.5)
                             + 0.45 * np.sin(2 * np.pi * (xs_h / c.aspect * (1.1 + 0.5 * k) + 0.3 * k)))
        col = upscale(_hill_colour(c, rng, pal, k, line_h, near), W, H)
        line = np.interp(x1, xs_h, line_h)[None, :]
        inside = smoothstep(-0.0016, 0.0016, y1 - line)
        if k > 0:
            ao = np.exp(-(((line - y1) / 0.028) ** 2)) * (y1 < line)
            img *= (1.0 - 0.22 * ao)[..., None]
        rim = np.exp(-(((y1 - line) / 0.005) ** 2)) * (y1 >= line) * (0.18 + 0.30 * near)
        col += (rgb(pal["hill_light"]) - col) * rim[..., None]
        img += (col - img) * inside[..., None]

    # the clock side stays low in detail and value: flattened towards its local mean, dimmed (dark) or paled (light)
    calm = (1.0 - smoothstep(0.14, 0.58, c.u))[..., None]
    img += (blur(img, 0.045 * H) - img) * (0.62 * calm)
    if dark:
        img *= 1.0 - pal["calm_dim"] * calm
    else:
        img += (rgb("#e6ecee") - img) * (0.42 * calm)
    return clamp01(img)


def _screen(c: Canvas, scene: np.ndarray, dark: bool) -> np.ndarray:
    """Halftone overlay. Ink dots grow in the shadows, pale dots in the sky and lights; sizes come from the cell's tone."""
    p = SCREEN_PITCH_REF * c.h / 2160.0
    ca, sa = math.cos(SCREEN_ANGLE), math.sin(SCREEN_ANGLE)
    xs = np.arange(c.w, dtype=F32) + 0.5
    ys = np.arange(c.h, dtype=F32) + 0.5
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
    L = cv2.remap(blur(lum, 0.45 * p), cx.astype(F32), cy.astype(F32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

    # dot radius as a fraction of the pitch: 0.5 touches its neighbours, 0.71 closes the cell
    if dark:
        ink_f = 0.62 * smoothstep(0.34, 0.08, L)
        pale_f = (0.15 + 0.40 * smoothstep(0.18, 0.70, L)) * (1.0 - smoothstep(0.80, 0.95, L))
    else:
        ink_f = 0.62 * smoothstep(0.60, 0.24, L)
        pale_f = (0.14 + 0.46 * smoothstep(0.50, 0.88, L)) * (1.0 - smoothstep(0.86, 0.97, L))
    # the sky and the snow carry the pale dots; the hills below the mist are mostly ink in their shadows
    sky_cell = 1.0 - smoothstep(0.60, 0.70, cy / c.h)
    hill_pale = (0.08 + 0.22 * smoothstep(0.45, 0.80, L)) if dark else (0.07 + 0.20 * smoothstep(0.55, 0.85, L))
    pale_f = hill_pale + (pale_f - hill_pale) * sky_cell
    side = 0.55 + 0.45 * smoothstep(0.18, 0.60, cx / c.w)                  # smaller dots on the clock side
    ink_f, pale_f = (ink_f * side).astype(F32), (pale_f * side).astype(F32)

    u = xs[None, :] * ca + ys[:, None] * sa
    v = -xs[None, :] * sa + ys[:, None] * ca
    ii = np.floor(u / p).astype(np.int32) - i0
    jj = np.floor(v / p).astype(np.int32) - j0
    dist = np.hypot(u - (ii + i0 + 0.5) * p, v - (jj + j0 + 0.5) * p)
    r_ink, r_pale = ink_f[jj, ii] * p, pale_f[jj, ii] * p
    cov_ink = disc_cover(r_ink, dist) * (r_ink > 0.0)
    cov_pale = disc_cover(r_pale, dist) * (r_pale > 0.0)

    if dark:
        ink, pale, k_ink, k_pale = rgb("#070b1c"), rgb("#dfe8f6"), 0.92, 0.74
    else:
        ink, pale, k_ink, k_pale = rgb("#2d3f66"), rgb("#ffffff"), 0.82, 0.82
    corner = smoothstep(0.58, 0.82, c.u) * smoothstep(0.48, 0.12, c.v)
    veil = (0.14 + 0.86 * smoothstep(0.18, 0.60, c.u)) * (1.0 - 0.85 * corner)    # the widget zones keep a faint screen only
    img = scene + (ink - scene) * (k_ink * veil * cov_ink)[..., None]
    img = img + (pale - img) * (k_pale * veil * cov_pale)[..., None]
    return clamp01(img)


def _render(c: Canvas, mode: str, seed: int) -> np.ndarray:
    dark = mode == "dark"
    rng = np.random.default_rng(seed)
    scene = _scene(c, rng, dark)
    return _screen(c, scene, dark)


STYLES = [
    Style("halftone-ridge", "Screen Ridge", "halftone landscape", 5601,
          {"dark": "#7aa346", "light": "#2d3f66"}, _render, {"dark": 1.8, "light": 1.5}),
]

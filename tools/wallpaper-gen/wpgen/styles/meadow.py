"""Wind-swept meadow with wild flowers drawn as chains of small dots (white petals, yellow hearts)."""
from __future__ import annotations

import math

import cv2
import numpy as np

from ..core import (F32, Canvas, blur, clamp01, eval_waves_pointwise, fbm, make_waves, ramp, rgb, smoothstep, upscale)
from ..flora import bezier
from ..registry import Style

WIND = -0.42                  # mean blade direction (radians, y down): rising towards the right
FLOW_SWAY = 0.55              # how far the wind direction wanders about its mean
DOT_PITCH_REF = 9.4           # spacing of the dots along a petal, in 4K pixels
DOT_RADIUS_REF = 3.9          # dot radius in 4K pixels
SHIFT = 4                     # sub-pixel bits for cv2 drawing
GRASS_LAYERS = (              # (blades, length range in canvas heights, 4K thickness px, blur sigma 4K px, opacity)
    (1500, (0.16, 0.36), 6, 4.0, 0.85),
    (2600, (0.09, 0.24), 3, 1.2, 0.90),
    (1800, (0.06, 0.18), 2, 0.5, 0.95),
)


def _angle_field(rng):
    waves = make_waves(rng, 8, 0.45, 1.6, slope=0.9)
    return lambda x, y: WIND + FLOW_SWAY * 0.5 * eval_waves_pointwise(x, y, waves)


def _lic(noise, ux, uy, steps, step_px):
    """Line integral convolution: smear ``noise`` along the unit vector field (ux, uy)."""
    h, w = noise.shape
    gx, gy = np.meshgrid(np.arange(w, dtype=F32), np.arange(h, dtype=F32))
    acc = noise.copy()
    for sign in (1.0, -1.0):
        px, py = gx.copy(), gy.copy()
        for _ in range(steps):
            vx = cv2.remap(ux, px, py, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
            vy = cv2.remap(uy, px, py, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
            px += sign * step_px * vx
            py += sign * step_px * vy
            acc += cv2.remap(noise, px, py, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    acc /= 2 * steps + 1
    return acc / (acc.std() + 1e-6)


def _streaks(c: Canvas, rng, angle, factor, steps, step_px, sigma):
    """Fine motion-blurred grass texture at 1/factor resolution, upsampled to the canvas."""
    w, h = max(8, c.w // factor), max(8, c.h // factor)
    ys = ((np.arange(h, dtype=F32) + 0.5) / h)[:, None]
    xs = ((np.arange(w, dtype=F32) + 0.5) / h)[None, :]
    th = angle(xs, ys).astype(F32)
    noise = cv2.GaussianBlur(rng.standard_normal((h, w)).astype(F32), (0, 0), sigma)
    noise /= noise.std() + 1e-6
    out = _lic(noise, np.cos(th).astype(F32), np.sin(th).astype(F32), steps, step_px)
    return upscale(out, c.w, c.h)


def _blades(c: Canvas, rng, angle, palette, layer_idx):
    """One depth layer of curved blades as premultiplied RGBA uint8."""
    count, (lo, hi), thick_ref, _sigma, _op = GRASS_LAYERS[layer_idx]
    scale = c.h / 2160.0
    rgba = np.zeros((c.h, c.w, 4), dtype=np.uint8)
    n_pts = 12
    x = rng.uniform(-0.05, c.aspect + 0.05, count).astype(F32)
    y = rng.uniform(-0.05, 1.1, count).astype(F32)
    length = rng.uniform(lo, hi, count).astype(F32)
    curl = rng.normal(0.0, 0.9, count).astype(F32)
    tone = rng.uniform(0.0, 1.0, count).astype(F32)
    xs, ys = [x], [y]
    for k in range(1, n_pts):
        th = angle(xs[-1], ys[-1]) + curl * (k / n_pts) ** 2 * 0.6
        xs.append(xs[-1] + length / (n_pts - 1) * np.cos(th))
        ys.append(ys[-1] + length / (n_pts - 1) * np.sin(th))
    px = np.stack(xs, axis=1) * c.h
    py = np.stack(ys, axis=1) * c.h
    cols = (ramp(tone, palette) * 255.0).astype(np.float64)
    t_px = max(1, int(round(thick_ref * scale)))
    t_tip = max(1, int(round(thick_ref * 0.5 * scale)))
    for i in range(count):
        pts = np.round(np.stack([px[i], py[i]], axis=1) * (1 << SHIFT)).astype(np.int32)
        col = (float(cols[i, 0]), float(cols[i, 1]), float(cols[i, 2]), 255.0)
        cv2.polylines(rgba, [pts[:7].reshape(-1, 1, 2)], False, col, t_px, cv2.LINE_AA, SHIFT)
        cv2.polylines(rgba, [pts[6:].reshape(-1, 1, 2)], False, col, t_tip, cv2.LINE_AA, SHIFT)
    return rgba


def _chain(pts, spacing):
    """Points spaced ``spacing`` apart along a polyline (units of ``pts``)."""
    seg = np.hypot(*np.diff(pts, axis=0).T)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    t = np.arange(0.0, s[-1], spacing)
    return np.stack([np.interp(t, s, pts[:, 0]), np.interp(t, s, pts[:, 1])], axis=1), t / max(s[-1], 1e-9)


def _head(rng, cx, cy, radius, squash, rot, n_petals):
    """Dot chains of a spidery flower head, as (kind, points in height units, reach); plus scattered heart dots."""
    ca, sa = math.cos(rot), math.sin(rot)

    def place(u, v):
        v = v * squash
        return cx + radius * (u * ca - v * sa), cy + radius * (u * sa + v * ca)

    chains = []
    for _ in range(n_petals):
        a0 = rng.uniform(0.0, 2.0 * math.pi)
        reach = rng.uniform(0.28, 1.0) ** 0.85
        curl = rng.normal(0.0, 0.6)
        t = np.linspace(0.0, 1.0, 24)
        ang = a0 + curl * t**2
        rad = reach * (0.06 + 0.94 * t)
        chains.append(("petal", np.stack([rad * np.cos(ang), rad * np.sin(ang)], axis=1), reach))
    for _ in range(4):                   # short ragged outlines hugging the head
        a0 = rng.uniform(0.0, 2.0 * math.pi)
        span = rng.uniform(0.35, 0.95)
        r0 = rng.uniform(0.95, 1.22)
        t = np.linspace(0.0, 1.0, 30)
        ang = a0 + span * t
        rr = r0 * (1.0 + 0.035 * np.sin(4.0 * t + a0))
        chains.append(("outline", np.stack([rr * np.cos(ang), rr * np.sin(ang)], axis=1), r0))
    chains = [(kind, np.array([place(u, v) for u, v in pts], dtype=F32), reach) for kind, pts, reach in chains]
    # a dense heart of loose dots, thinning out with distance
    r = np.abs(rng.normal(0.0, 0.26, 340))
    a = rng.uniform(0.0, 2.0 * math.pi, 340)
    heart = [(*place(rr * math.cos(aa), rr * math.sin(aa)), rr) for rr, aa in zip(r, a)]
    return chains, heart


def _stem_chains(c: Canvas):
    """Stems and side shoots as polylines in height units."""
    return [
        bezier((1.15, 1.08), (1.02, 0.84), (1.34, 0.70), (1.27, 0.46), 50),
        bezier((1.27, 0.64), (1.40, 0.62), (1.52, 0.70), (1.56, 0.60), 24),
        bezier((1.20, 0.86), (1.05, 0.82), (0.98, 0.78), (0.96, 0.70), 24),
    ]


def _dots(c: Canvas, rng, white, yellow):
    """Draw every dot chain into two uint8 masks (white and yellow dots)."""
    scale = c.h / 2160.0
    pitch = DOT_PITCH_REF * scale / c.h
    rad = DOT_RADIUS_REF * scale

    def draw(layer, x, y, r):
        cv2.circle(layer, (int(round(x * c.h * (1 << SHIFT))), int(round(y * c.h * (1 << SHIFT)))),
                   int(round(r * (1 << SHIFT))), 255, -1, cv2.LINE_AA, SHIFT)

    heads = [(1.20, 0.40, 0.25, 0.74, -0.35, 130), (0.98, 0.68, 0.19, 0.78, 0.30, 90), (1.58, 0.72, 0.15, 0.80, 0.8, 70)]
    for cx, cy, r, sq, rot, n in heads:
        chains, heart = _head(rng, cx, cy, r, sq, rot, n)
        for kind, pts, reach in chains:
            chain, tt = _chain(pts, pitch)
            for (x, y), t in zip(chain, tt):
                jx, jy = rng.normal(0.0, 0.5 * scale / c.h, 2)
                size = rad * (0.78 + 0.45 * rng.random()) * (1.0 - 0.28 * t)
                yellow_p = 0.40 * math.exp(-(((t if kind == "petal" else 0.5) - 0.62) / 0.25) ** 2) * (kind == "petal")
                draw(yellow if rng.random() < yellow_p else white, x + jx, y + jy, size)
        for x, y, rr in heart:
            draw(yellow if rng.random() < 0.22 * math.exp(-(((rr - 0.45) / 0.20) ** 2)) else white, x, y,
                 rad * rng.uniform(0.75, 1.25))
    for stem in _stem_chains(c):
        for off in (-0.0055, 0.0055):
            d = np.gradient(stem, axis=0)
            n = np.stack([-d[:, 1], d[:, 0]], axis=1)
            n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
            chain, tt = _chain(stem + n * off, pitch * 1.15)
            for x, y in chain:
                draw(white, x, y, rad * rng.uniform(0.7, 1.05))
        chain, tt = _chain(stem, pitch * 3.6)
        for (x, y), t in zip(chain, tt):
            draw(yellow if rng.random() < 0.4 else white, x, y, rad * 0.9)


def _render(c: Canvas, mode: str, seed: int) -> np.ndarray:
    dark = mode == "dark"
    rng = np.random.default_rng(seed)
    angle = _angle_field(rng)
    if dark:
        pal = [(0.0, "#070f06"), (0.25, "#12220b"), (0.52, "#27421a"), (0.76, "#46652a"), (0.92, "#6f8c44"), (1.0, "#a4b878")]
        tone_lo, tone_hi = 0.15, 0.86
    else:
        pal = [(0.0, "#5d7a3a"), (0.25, "#789a4c"), (0.52, "#9bb766"), (0.76, "#bcd18a"), (0.92, "#dce8b4"), (1.0, "#f4f8d8")]
        tone_lo, tone_hi = 0.12, 0.98

    low = fbm(rng, c.w // 4, c.h // 4, 3.0, 4)
    fine = _streaks(c, rng, angle, 2, 26, 1.4, 0.65)
    coarse = _streaks(c, rng, angle, 4, 36, 2.2, 0.9)
    tone = 0.50 + 0.15 * upscale(low, c.w, c.h) + 0.12 * fine + 0.16 * coarse
    img = ramp(np.clip(tone_lo + (tone_hi - tone_lo) * tone, 0.0, 1.0), pal)

    for idx, (_n, _l, _t, sigma_ref, op) in enumerate(GRASS_LAYERS):
        rgba = _blades(c, rng, angle, pal[1:] if idx == 0 else pal, idx).astype(F32) / 255.0
        s = sigma_ref * c.h / 2160.0
        if s > 0.25:
            rgba = blur(rgba, s)
        img = img * (1.0 - op * rgba[..., 3:4]) + op * rgba[..., :3]
        del rgba

    white = np.zeros((c.h, c.w), dtype=np.uint8)
    yellow = np.zeros((c.h, c.w), dtype=np.uint8)
    _dots(c, rng, white, yellow)
    wcov = white.astype(F32) / 255.0
    ycov = yellow.astype(F32) / 255.0
    cover = np.maximum(wcov, ycov)

    # the clock side is shallow depth of field: calm, soft grass
    calm = smoothstep(0.26, 0.60, c.u)
    soft = blur(img, 0.012 * c.h)
    img = soft + (img - soft) * (0.30 + 0.70 * calm)[..., None]

    if dark:
        wcol, ycol = rgb("#fbfbf0"), rgb("#f2ee3a")
        glow = blur(cover, 0.010 * c.h)
        img = img + (rgb("#f4f4cc") - img) * (0.28 * clamp01(glow * 2.0))[..., None]
    else:
        wcol, ycol = rgb("#ffffff"), rgb("#f6d423")
        shade = blur(np.roll(cover, (2, 2), axis=(0, 1)), 1.0 * c.h / 2160.0)
        img = img * (1.0 - 0.38 * shade)[..., None]
    img = img + (wcol - img) * wcov[..., None]
    img = img + (ycol - img) * ycov[..., None]
    return clamp01(img)


STYLES = [
    Style("meadow-dots", "Wind Meadow", "dotted wild flowers on wind-swept grass", 5401,
          {"dark": "#f2ee3a", "light": "#f6d423"}, _render, {"dark": 2.0, "light": 1.8}),
]

"""Topographic contour lines: analytic-gradient iso-lines with index contours, survey crosses and one red summit marker."""
from __future__ import annotations

import numpy as np

from ..core import F32, Canvas, clamp01, eval_waves, interest_mask, make_waves, rgb


def _terrain(c: Canvas, rng):
    """Smooth random terrain plus a few mountains; returns h, |grad h| (per height unit) and the summit position."""
    wv = make_waves(rng, 44, 0.7, 6.5, slope=1.35)
    h, hx, hy = eval_waves(c.xs, c.ys, wv, grad=True)
    X, Y = c.x, c.y
    summit = None
    for (mx, my, sig, amp) in [(1.28, 0.54, 0.34, 3.4), (1.62, 0.86, 0.20, 1.8), (0.92, 0.80, 0.22, -1.6)]:
        g = amp * np.exp(-((X - mx) ** 2 + (Y - my) ** 2) / (2 * sig**2)).astype(F32)
        h = h + g
        hx = hx + g * (-(X - mx) / sig**2)
        hy = hy + g * (-(Y - my) / sig**2)
    return h.astype(F32), hx.astype(F32), hy.astype(F32)


def _render(c: Canvas, mode: str, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    dark = mode == "dark"
    h, hx, hy = _terrain(c, rng)
    grad = np.sqrt(hx * hx + hy * hy) + 1e-3

    step = 0.19                                      # contour interval in field units
    t = h / step
    k = np.round(t)
    dpx = np.abs(t - k) * step / grad * c.h          # distance to the nearest contour, in output pixels
    is_index = (np.mod(k, 5.0) == 0.0)
    s = c.h / 2160.0
    w_minor, w_index = 1.7 * s, 3.4 * s
    w = np.where(is_index, w_index, w_minor)
    cov = np.clip(0.5 * w + 0.5 - dpx, 0.0, 1.0)

    # quiet the zones where widgets sit: lines thin out and fade towards the left and the top-right corner
    zone = interest_mask(c, left=(0.28, 0.62), corner=(0.62, 0.92), corner_v=(0.45, 0.05), floor=0.0)
    a_min = 0.07 + 0.93 * zone
    a_idx = 0.10 + 0.90 * zone

    if dark:
        bg = rgb("#111111")
        minor, index = rgb("#8a8a86"), rgb("#e8e6e3")
        am, ai = 0.72, 0.94
        red = rgb("#e94248")
    else:
        bg = rgb("#e8e6e3")
        minor, index = rgb("#3a3a38"), rgb("#111111")
        am, ai = 0.46, 0.88
        red = rgb("#e2363d")

    # very faint hillshade so the flat field carries a little depth
    shade = np.clip(-(hx * 0.55 + hy * 0.83) / (1.0 + grad), -1.0, 1.0)
    img = np.broadcast_to(bg, (c.h, c.w, 3)).astype(F32).copy()
    if dark:
        img += (0.010 * shade * zone)[..., None]
    else:
        img += (0.014 * shade * (0.3 + 0.7 * zone))[..., None]

    alpha_m = cov * np.where(is_index, 0.0, 1.0) * am * a_min
    alpha_i = cov * np.where(is_index, 1.0, 0.0) * ai * a_idx
    img = img + (minor - img) * alpha_m[..., None]
    img = img + (index - img) * alpha_i[..., None]

    # survey crosses on a coarse lattice
    p = 0.30
    fx = (c.xs / p + 0.5) % 1.0 - 0.5
    fy = (c.ys / p + 0.5) % 1.0 - 0.5
    arm = 0.014
    wpx = 1.6 * s / c.h
    horiz = (np.abs(fy)[:, None] * p < wpx * 0.5 + 0.5 / c.h) & (np.abs(fx)[None, :] * p < arm)
    vert = (np.abs(fx)[None, :] * p < wpx * 0.5 + 0.5 / c.h) & (np.abs(fy)[:, None] * p < arm)
    cross = (horiz | vert).astype(F32) * (0.18 + 0.20 * zone)
    img = img + ((index if dark else rgb("#111111")) - img) * (cross * (0.55 if dark else 0.5))[..., None]

    # the single accent: a summit marker (dot + hairline ring) on the highest ground of the visible mountain
    u0, u1 = int(c.w * 0.50), int(c.w * 0.86)
    v0, v1 = int(c.h * 0.30), int(c.h * 0.80)
    sub = h[v0:v1, u0:u1]
    iy, ix = np.unravel_index(int(np.argmax(sub)), sub.shape)
    sx, sy = (u0 + ix + 0.5) / c.h, (v0 + iy + 0.5) / c.h
    r = np.sqrt((c.x - sx) ** 2 + (c.y - sy) ** 2)
    dot = c.coverage(r - c.ref(15.0))
    ring_d = np.abs(r - c.ref(52.0)) - 0.5 * c.ref(2.4)
    ring = c.coverage(ring_d)
    img = img + (red - img) * ring[..., None] * 0.9
    img = img + (red - img) * dot[..., None]
    return clamp01(img)


from ..registry import Style  # noqa: E402

STYLES = [
    Style("topo-lines", "Contour Field", "topographic contour lines", 2101,
          {"dark": "#e94248", "light": "#e2363d"}, _render, {"dark": 1.5, "light": 1.5}),
]

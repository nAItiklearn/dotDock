"""Layered waves with soft cast shadows: stacked diagonal ribbons, darkest at the back, one red at the front."""
from __future__ import annotations

import math

import numpy as np

from ..core import F32, Canvas, clamp01, ramp, rgb, smoothstep
from ..registry import Style


def _render(c: Canvas, mode: str, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    dark = mode == "dark"
    x, y = c.x, c.y
    alpha = math.radians(31.0)
    ch = np.array([math.cos(alpha), -math.sin(alpha)], dtype=F32)   # crest direction (rising to the right)
    nh = np.array([math.sin(alpha), math.cos(alpha)], dtype=F32)    # normal, towards the lower right
    s = x * ch[0] + y * ch[1]
    n = x * nh[0] + y * nh[1]

    K = 10
    # depth ramp, back (0) to front (1)
    if dark:
        stops = [(0.0, "#050202"), (0.25, "#150708"), (0.50, "#3a090c"), (0.72, "#7d1118"), (0.88, "#b9232b"),
                 (1.0, "#e94248")]
        img = np.broadcast_to(rgb("#050202"), (c.h, c.w, 3)).astype(F32).copy()
    else:
        stops = [(0.0, "#f2f0ed"), (0.30, "#e9e6e2"), (0.55, "#dfdcd7"), (0.78, "#d3d0cb"), (0.90, "#c6c3be"),
                 (1.0, "#e2363d")]
        img = np.broadcast_to(rgb("#f1efec"), (c.h, c.w, 3)).astype(F32).copy()

    # global light: strongest at the lower right, calm on the left and top-right
    lx = np.exp(-(((x - 1.85) ** 2 + (y - 1.15) ** 2) / (2 * 0.95**2))).astype(F32)
    corner = 1.0 - 0.65 * smoothstep(0.62, 0.95, c.u) * smoothstep(0.42, 0.04, y)
    light = (0.20 + 0.80 * lx) * corner
    if not dark:
        light = 0.35 + 0.65 * lx * corner

    n0 = -0.48
    gaps = rng.uniform(0.155, 0.205, K)
    nk = n0 + np.cumsum(gaps)
    phase0 = rng.uniform(0, 2 * math.pi)
    shadow_len = 0.05
    for k in range(K):
        t = k / (K - 1)
        a1 = 0.060 + 0.040 * rng.random()
        a2 = 0.016 + 0.014 * rng.random()
        f1 = 2 * math.pi / (1.30 + 0.25 * math.sin(k * 0.9))
        f2 = 2 * math.pi / (0.62 + 0.10 * math.cos(k * 1.3))
        ph1 = phase0 + k * 0.52 + rng.normal(0, 0.12)
        ph2 = rng.uniform(0, 2 * math.pi)
        arg1, arg2 = f1 * s + ph1, f2 * s + ph2
        edge = nk[k] + a1 * np.sin(arg1) + a2 * np.sin(arg2)
        slope = a1 * f1 * np.cos(arg1) + a2 * f2 * np.cos(arg2)
        d = (n - edge) / np.sqrt(1.0 + slope * slope)              # > 0 inside the layer
        cov = np.clip(0.5 + d * c.h, 0.0, 1.0)

        # cast shadow on whatever is already painted, just outside this layer's edge
        out = np.clip(-d, 0.0, None)
        sh = (0.62 if dark else 0.30) * np.exp(-out / shadow_len) * (1.0 - cov)
        img *= (1.0 - sh)[..., None]

        base = ramp(np.array([t], dtype=F32), stops)[0]
        # lit by the global light, brighter towards the leading (upper) edge of each ribbon
        rim = np.exp(-np.clip(d, 0.0, None) / 0.10)
        if dark:
            shade = base * (0.30 + 0.70 * (light ** 0.9)[..., None]) * (0.90 + 0.22 * rim)[..., None]
            if k == K - 1:
                shade = base * (0.52 + 0.46 * (light ** 0.8)[..., None]) * (0.93 + 0.08 * rim)[..., None]
        else:
            if k == K - 1:
                shade = base * (0.88 + 0.12 * light)[..., None] * (0.96 + 0.06 * rim)[..., None]
            else:
                shade = base * (0.97 + 0.03 * rim)[..., None] * (0.94 + 0.06 * light)[..., None]
        img += (shade - img) * cov[..., None]
    return clamp01(img)


STYLES = [
    Style("red-waves", "Crimson Strata", "layered waves with soft shadows", 7101,
          {"dark": "#b9232b", "light": "#e2363d"}, _render, {"dark": 1.4, "light": 1.4}),
]

"""Soft monochrome: overlapping out-of-focus petals of grey, crossed by thin wavy stems with sharp thorn tufts."""
from __future__ import annotations

import math

import numpy as np

from ..core import F32, Canvas, blur, clamp01, rgb, smoothstep, upscale
from ..registry import Style

PETALS = 22                    # overlapping soft petals, far to near
PETAL_ALPHA = 0.84             # petals are slightly translucent: the one beneath shows through where they overlap
STEM_TUFTS = ((0.30, 0.52, 0.76), (0.40, 0.66))   # where each stem carries a thorn tuft (canvas height fractions)
NEEDLES = (5, 7)               # thorns per side of a tuft (min, max)
LIGHT_DIR = (-0.62, -0.78)     # petals are lit from the upper left


def _petal_forms(rng, aspect):
    """Far-to-near list of (cx, cy, length, width, rot, tone, bend, asymmetry, edge softness) laid on a jittered grid.

    Far petals are large, pale and heavily blurred; near ones are smaller, sharper and a little darker.
    """
    cols, rows = 6, 4
    cells = [(i % cols, i // cols) for i in range(cols * rows)]
    rng.shuffle(cells)
    forms = []
    for gx, gy in cells[:PETALS]:
        depth = rng.uniform(0.0, 1.0)                                  # 0 far .. 1 near
        cx = ((gx + 0.5) / cols + rng.uniform(-0.07, 0.07)) * aspect
        cy = (gy + 0.5) / rows + rng.uniform(-0.09, 0.09)
        length = (0.62 - 0.30 * depth) * rng.uniform(0.85, 1.15)
        width = length * rng.uniform(0.34, 0.52)
        soft = 0.010 + 0.050 * (1.0 - depth) ** 1.4
        forms.append((depth, (cx, cy, length, width, rng.uniform(0.0, 2.0 * math.pi), 0.55 + 0.45 * depth * rng.uniform(0.4, 1.0),
                              rng.normal(0.0, 0.16), rng.uniform(-0.22, 0.22), soft)))
    forms.sort(key=lambda f: f[0])
    return [f for _, f in forms]


def _shift(a, dx_px, dy_px):
    h, w = a.shape
    out = np.zeros_like(a)
    sx, sy = int(round(dx_px)), int(round(dy_px))
    ys, yd = (slice(0, h - sy), slice(sy, h)) if sy >= 0 else (slice(-sy, h), slice(0, h + sy))
    xs, xd = (slice(0, w - sx), slice(sx, w)) if sx >= 0 else (slice(-sx, w), slice(0, w + sx))
    out[yd, xd] = a[ys, xs]
    return out


def _petal_layer(c: Canvas, form):
    """One petal: (shade 0..1, coverage). A rounded base swells to a broad belly and tapers to a point; the axis curls
    and one flank is fuller than the other. Shade has a lit flank, a soft belly and a faint midrib."""
    cx, cy, length, width, rot, _tone, bend, asym, soft = form
    ca, sa = math.cos(rot), math.sin(rot)
    dx, dy = c.x - cx, c.y - cy
    u = (dx * ca + dy * sa) / length                       # -1 at the base .. +1 at the tip
    v = (-dx * sa + dy * ca) / length - bend * u * u       # across, in units of the half-length
    t = np.clip(0.5 * u + 0.5, 0.0, 1.0)
    prof = 2.5 * np.sqrt(t) * (1.0 - t) ** 0.9             # round base, broad belly near t = 0.36, long taper to the tip
    half_w = (width / length) * prof * (1.0 + asym * np.sign(v))
    half_w = np.maximum(half_w, 1e-4)
    sd = np.maximum(np.abs(v) - half_w, np.abs(u) - 1.0) * length
    cov = smoothstep(soft, -soft, sd).astype(F32)
    nv = np.clip(v / half_w, -1.0, 1.0)
    facing = np.sign(v) * (-sa * LIGHT_DIR[0] + ca * LIGHT_DIR[1])        # +1 where the flank faces the light
    rim = smoothstep(0.35, 1.0, np.abs(nv))
    midrib = np.exp(-((v / (0.06 * np.maximum(half_w, 0.02))) ** 2)) * smoothstep(0.0, 0.3, t) * 0.07
    shade = 0.66 + 0.26 * (1.0 - nv**2) * (0.5 + 0.5 * t) - 0.30 * rim * (1.0 - facing) * 0.5 + 0.14 * rim * facing - midrib
    return shade.astype(F32), cov


def _tapered_cover(c: Canvas, pts, r0, r1):
    """Coverage (in a bounding box) of a polyline whose radius tapers linearly from r0 to r1 (height units)."""
    pts = np.asarray(pts, dtype=F32)
    pad = max(r0, r1) + 3 * c.pix
    x0 = max(0, int((pts[:, 0].min() - pad) * c.h))
    x1 = min(c.w, int((pts[:, 0].max() + pad) * c.h) + 1)
    y0 = max(0, int((pts[:, 1].min() - pad) * c.h))
    y1 = min(c.h, int((pts[:, 1].max() + pad) * c.h) + 1)
    if x1 <= x0 or y1 <= y0:
        return None
    X = c.xs[None, x0:x1]
    Y = c.ys[y0:y1, None]
    best = np.full((y1 - y0, x1 - x0), 9.0, dtype=F32)
    seg = np.diff(pts, axis=0)
    n = len(seg)
    for i in range(n):
        ax, ay = pts[i]
        bx, by = seg[i]
        l2 = bx * bx + by * by + 1e-12
        t = np.clip(((X - ax) * bx + (Y - ay) * by) / l2, 0.0, 1.0)
        d = np.hypot(X - ax - t * bx, Y - ay - t * by) - (r0 + (r1 - r0) * ((i + t) / n))
        np.minimum(best, d, out=best)
    return (y0, y1, x0, x1), c.coverage(best)


def _stem_curves(aspect):
    """Two stems crossing top to bottom: x(y), half-width(y) and the slope for perpendicular distance."""
    def a(y):
        return 0.80 + 0.12 * y + 0.062 * np.sin(2 * np.pi * 1.20 * y + 0.4) + 0.011 * np.sin(2 * np.pi * 4.3 * y + 1.1)

    def b(y):
        return 1.18 + 0.22 * y + 0.070 * np.sin(2 * np.pi * 1.10 * y + 2.2) + 0.012 * np.sin(2 * np.pi * 5.1 * y + 0.3)

    return a, b


def _needles(c: Canvas, rng, cx, cy, bearing):
    """Thorn tuft at (cx, cy): thin tapered needles fanning out around ``bearing`` (radians)."""
    out = []
    n = int(rng.integers(NEEDLES[0], NEEDLES[1] + 1))
    for _ in range(n):
        ang = bearing + rng.normal(0.0, 0.85)
        length = rng.uniform(0.034, 0.078)
        bend = rng.normal(0.0, 0.5)
        t = np.linspace(0.0, 1.0, 12)
        a = ang + bend * t
        px = cx + length * np.cumsum(np.cos(a) / 12.0)
        py = cy + length * np.cumsum(np.sin(a) / 12.0)
        pts = np.stack([np.concatenate([[cx], px]), np.concatenate([[cy], py])], axis=1)
        out.append((pts, rng.uniform(0.0014, 0.0022)))
    return out


def _render(c: Canvas, mode: str, seed: int) -> np.ndarray:
    dark = mode == "dark"
    rng = np.random.default_rng(seed)
    x, y = c.x, c.y

    if dark:
        lo, hi = rgb("#09090a"), rgb("#5c5c61")
        stem_col, halo_col = rgb("#dedcd8"), rgb("#9a9a9c")
        shadow_k, rim_gain = 0.40, 1.0
    else:
        lo, hi = rgb("#9c9c9f"), rgb("#f3f3f4")
        stem_col, halo_col = rgb("#161617"), rgb("#2a2a2c")
        shadow_k, rim_gain = 0.20, 1.0

    # the petals are soft by nature, so they are painted at half resolution and enlarged
    soft_c = Canvas(c.w // 2, c.h // 2)
    sx, sy = soft_c.x, soft_c.y
    img = (lo + (hi - lo) * (0.30 + 0.30 * np.exp(-(((sx - 1.10) ** 2 + (sy - 0.40) ** 2) / (2 * 0.8**2))))[..., None]).astype(F32)
    for form in _petal_forms(rng, c.aspect):
        shade, cov = _petal_layer(soft_c, form)
        sh = blur(_shift(cov, 0.040 * soft_c.h, 0.060 * soft_c.h), 0.040 * soft_c.h)
        img *= (1.0 - shadow_k * sh)[..., None]
        tone = form[5]
        level = clamp01(shade * rim_gain * (0.62 + 0.38 * tone))
        pet = lo + (hi - lo) * level[..., None]
        img = img + (pet - img) * (PETAL_ALPHA * cov)[..., None]
    img = upscale(img, c.w, c.h)
    img = blur(img, 0.0045 * c.h)                       # the whole forest of petals is a little out of focus

    # stems: x(y) curves with a gentle taper; perpendicular distance corrects for the slope
    stem_a, stem_b = _stem_curves(c.aspect)
    yy = c.ys
    dy = 1.0 / c.h
    cover = np.zeros((c.h, c.w), dtype=F32)
    for k, curve in enumerate((stem_a, stem_b)):
        xc = curve(yy)
        slope = np.gradient(xc, dy)
        hw = (0.0019 + 0.0022 * yy + 0.0008 * np.sin(2 * np.pi * (3.4 + k) * yy + k)).astype(F32)
        d = np.abs(x - xc[:, None]) / np.sqrt(1.0 + slope[:, None] ** 2) - hw[:, None]
        cover = np.maximum(cover, c.coverage(d))

    # thorn tufts at the nodes; behind them an out-of-focus smudge of the same stem colour
    needle = np.zeros_like(cover)
    smudge = np.zeros_like(cover)
    for curve, nodes in zip((stem_a, stem_b), STEM_TUFTS):
        for ny in nodes:
            nx = float(curve(ny))
            for pts, r0 in _needles(c, rng, nx, ny, -0.35) + _needles(c, rng, nx, ny, math.pi + 0.35):
                got = _tapered_cover(c, pts, r0, 0.0002)
                if got is not None:
                    (y0, y1, x0, x1), cv = got
                    needle[y0:y1, x0:x1] = np.maximum(needle[y0:y1, x0:x1], cv)
            smudge += np.exp(-(((x - nx) ** 2 + (y - ny) ** 2) / (2 * 0.030**2))).astype(F32)
    cover = np.maximum(cover, needle)

    # a third, soft stem climbing out of the lower-right corner, well out of focus
    t = np.linspace(0.0, 1.0, 40)
    sx = 1.24 + 0.62 * t
    sy = 1.04 - 0.34 * t - 0.04 * np.sin(t * 5.0)
    far = np.zeros_like(cover)
    got = _tapered_cover(c, np.stack([sx, sy], axis=1), 0.0100, 0.0045)
    if got is not None:
        (y0, y1, x0, x1), cv = got
        far[y0:y1, x0:x1] = cv
    far = blur(far, 0.011 * c.h)
    smudge += 1.6 * np.exp(-(((x - 1.70) ** 2 + (y - 0.74) ** 2) / (2 * 0.060**2))).astype(F32)

    img = img + (halo_col - img) * (0.30 * clamp01(blur(smudge, 0.010 * c.h)))[..., None]
    img = img + (stem_col - img) * ((0.55 if dark else 1.0) * far)[..., None]
    img = img + (stem_col - img) * (0.28 * blur(cover, 0.005 * c.h))[..., None]
    img = img + (stem_col - img) * cover[..., None]
    return clamp01(img)


STYLES = [
    Style("soft-mono", "Petal Haze", "soft monochrome petals with thorn stems", 9101,
          {"dark": "#d6d4d0", "light": "#8a8a86"}, _render, {"dark": 2.3, "light": 2.0}),
]

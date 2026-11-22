"""Flat geometry: charcoal circle / pill / stadium rings, and warm paper with a bold ring and one red segment."""
from __future__ import annotations

import math

import numpy as np

from ..core import F32, Canvas, blur, clamp01, eval_waves, lowres_eval, make_waves, rgb, smoothstep
from ..registry import Style


# --- signed distance fields (height units, negative inside) ------------------------------------
def sd_circle(x, y, cx, cy, r):
    return np.sqrt((x - cx) ** 2 + (y - cy) ** 2) - r


def sd_capsule(x, y, ax, ay, bx, by, r):
    """Distance to the segment a-b minus r: a stadium of radius r."""
    abx, aby = bx - ax, by - ay
    t = np.clip(((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby), 0.0, 1.0)
    return np.sqrt((x - ax - t * abx) ** 2 + (y - ay - t * aby) ** 2) - r


def _over(img, color, cov):
    return img + (color - img) * cov[..., None]


def _shadow(c: Canvas, cov, dx, dy, sigma_ref, opacity):
    """Soft drop shadow of a coverage mask, as a multiplier (H,W). The shift does not wrap around."""
    sx, sy = int(round(dx * c.h)), int(round(dy * c.h))
    sh = np.zeros_like(cov, dtype=F32)
    h, w = cov.shape
    ys, yd = (slice(0, h - sy), slice(sy, h)) if sy >= 0 else (slice(-sy, h), slice(0, h + sy))
    xs, xd = (slice(0, w - sx), slice(sx, w)) if sx >= 0 else (slice(-sx, w), slice(0, w + sx))
    sh[yd, xd] = cov[ys, xs]
    sh = blur(sh, sigma_ref * c.h / 2160.0)
    return (1.0 - opacity * sh).astype(F32)


# ---------------------------------------------------------------------------
# flat-stadium
# ---------------------------------------------------------------------------
def _render_stadium(c: Canvas, mode: str, seed: int) -> np.ndarray:
    x, y = c.x, c.y
    dark = mode == "dark"
    if dark:
        bg, band, gap, core = rgb("#181818"), rgb("#2b2b2b"), rgb("#0b0b0b"), rgb("#202020")
        pill, disc, dot = rgb("#0b0b0b"), rgb("#8a8a86"), rgb("#e94248")
    else:
        bg, band, gap, core = rgb("#dedcd8"), rgb("#cfcdc9"), rgb("#f1f0ee"), rgb("#e6e4e1")
        pill, disc, dot = rgb("#f4f3f1"), rgb("#b4b2ad"), rgb("#e2363d")

    # soft background lift so the flat field is never dead
    lift = np.exp(-(((x - 1.25) ** 2 + (y - 0.6) ** 2) / (2 * 0.9**2))).astype(F32)
    white = rgb("#ffffff")
    img = bg + (white - bg) * (0.018 if dark else 0.30) * lift[..., None]

    # concentric stadium rings opening to the right, partly under the pill
    ax, ay, bx = 1.38, 0.60, 3.4
    d = sd_capsule(x, y, ax, ay, bx, ay, 0.0)
    r_out, r_gap, r_core = 0.50, 0.375, 0.235
    img = _over(img, band, c.coverage(d - r_out))
    img = _over(img, gap, c.coverage(d - r_gap))
    img = _over(img, core, c.coverage(d - r_core))
    if not dark:
        # carved look: soft inner shadows on the light variant
        ring_in = c.coverage(d - r_gap) * (1.0 - c.coverage(d - r_core))
        sh = blur(ring_in.astype(F32), 24 * c.h / 2160.0)
        img = img * (1.0 - 0.10 * sh)[..., None]

    # the pill, overlapping the rings from the left
    dp = sd_capsule(x, y, -0.6, 0.88, 1.02, 0.88, 0.26)
    cov_p = c.coverage(dp)
    if not dark:
        img = img * _shadow(c, cov_p, 0.006, 0.020, 26, 0.30)[..., None]
    img = _over(img, pill, cov_p)

    # the muted disc
    dd = sd_circle(x, y, 0.93, 0.215, 0.125)
    cov_d = c.coverage(dd)
    if not dark:
        img = img * _shadow(c, cov_d, 0.005, 0.016, 22, 0.28)[..., None]
    img = _over(img, disc, cov_d)
    # subtle top-left lift on the disc keeps it from looking cut out
    spec = np.exp(-(((x - 0.90) ** 2 + (y - 0.18) ** 2) / (2 * 0.06**2))) * cov_d
    img = img + (rgb("#ffffff") - img) * (0.10 * spec)[..., None]

    # the one accent: a small status dot sitting in the dark gap of the rings
    dr = sd_circle(x, y, ax, ay - (r_gap + r_core) / 2.0, 0.021)
    img = _over(img, dot, c.coverage(dr))
    return clamp01(img)


# ---------------------------------------------------------------------------
# paper-ring
# ---------------------------------------------------------------------------
def _sd_arc(x, y, cx, cy, R, a0, a1, t):
    """Distance to a round-capped arc of centre-line radius R, thickness t, from angle a0 to a1 (y-down)."""
    mid = 0.5 * (a0 + a1)
    hw = 0.5 * (a1 - a0)
    th = np.arctan2(y - cy, x - cx)
    rel = np.angle(np.exp(1j * (th - mid))).astype(F32)
    cl = np.clip(rel, -hw, hw)
    px = cx + R * np.cos(mid + cl)
    py = cy + R * np.sin(mid + cl)
    return np.sqrt((x - px) ** 2 + (y - py) ** 2) - t * 0.5


def _paper(c: Canvas, rng, dark: bool):
    if dark:
        base = rgb("#111111")
        dotc = rgb("#202020")
    else:
        base = rgb("#e8e6e3")
        dotc = rgb("#d6d3ce")
    # faint paper mottling from low-frequency waves
    wv = make_waves(rng, 18, 0.6, 5.0, slope=1.1)
    wf = lowres_eval(c, lambda xs, ys: eval_waves(xs[0], ys[:, 0], wv), 8)
    img = base + (wf * (0.0035 if not dark else 0.0025))[..., None]
    # dot grid
    p = 40.0 * c.h / 2160.0
    xs = np.arange(c.w, dtype=F32) + 0.5
    ys = np.arange(c.h, dtype=F32) + 0.5
    fx = (xs - c.w / 2.0 + p / 2) % p - p / 2
    fy = (ys - c.h / 2.0 + p / 2) % p - p / 2
    dist = np.hypot(fx[None, :], fy[:, None])
    cov = np.clip(2.3 * c.h / 2160.0 + 0.5 - dist, 0, 1)
    # the grid lives mostly in the busy zone; it fades slightly towards the left edge
    cov = cov * (0.55 + 0.45 * smoothstep(0.0, 0.5, c.u))
    return img + (dotc - img) * (cov * (0.85 if not dark else 0.9))[..., None]


def _render_paper(c: Canvas, mode: str, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    dark = mode == "dark"
    x, y = c.x, c.y
    img = _paper(c, rng, dark)
    ink = rgb("#e8e6e3") if dark else rgb("#111111")
    red = rgb("#e94248") if dark else rgb("#e2363d")

    cx, cy, R, t = 1.24, 0.585, 0.285, 0.092
    deg = math.pi / 180.0
    black = _sd_arc(x, y, cx, cy, R, 128 * deg, 392 * deg, t)
    redarc = _sd_arc(x, y, cx, cy, R, 418 * deg, 460 * deg, t)
    cov_b, cov_r = c.coverage(black), c.coverage(redarc)

    if not dark:
        both = np.maximum(cov_b, cov_r)
        img = img * _shadow(c, both, 0.004, 0.018, 34, 0.17)[..., None]
        img = img * _shadow(c, both, 0.001, 0.005, 6, 0.13)[..., None]
    img = _over(img, ink, cov_b)
    img = _over(img, red, cov_r)

    # inner hairline: a ring of small dots (dot-matrix, echoing the sphere wallpaper)
    n = 72
    r_in = R - t * 0.5 - 0.050
    th = np.arctan2(y - cy, x - cx)
    k = np.round(th / (2 * math.pi) * n)
    ph = k * (2 * math.pi / n)
    d = np.sqrt((x - cx - r_in * np.cos(ph)) ** 2 + (y - cy - r_in * np.sin(ph)) ** 2) - 0.0034
    dotcov = c.coverage(d)
    dot_ink = rgb("#8a8a86") if dark else (ink + rgb("#8a8a86")) * 0.5
    img = _over(img, dot_ink, dotcov)
    # solid pupil, slightly off-centre
    dp = sd_circle(x, y, cx, cy, 0.036)
    if not dark:
        img = img * _shadow(c, c.coverage(dp), 0.002, 0.007, 8, 0.14)[..., None]
    img = _over(img, ink, c.coverage(dp))
    return clamp01(img)


STYLES = [
    Style("flat-stadium", "Stadium Rings", "flat charcoal geometry", 6101,
          {"dark": "#e94248", "light": "#e2363d"}, _render_stadium, {"dark": 1.2, "light": 1.2}),
    Style("paper-ring", "Paper Ring", "warm paper with ring and red segment", 6202,
          {"dark": "#e94248", "light": "#e2363d"}, _render_paper, {"dark": 1.3, "light": 1.7}),
]

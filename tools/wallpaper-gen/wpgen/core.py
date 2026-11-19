"""Shared maths, colour, field and coordinate helpers for the dotDock wallpaper generator.

Everything here is resolution independent: shapes are described in "height units"
(1.0 == the canvas height), and pixel-sized details (hairlines, dot pitch, grain) are
expressed in 4K reference pixels via ``Canvas.ref`` so that a 1280x720 preview looks
like a scaled-down version of the 3840x2160 master.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

F32 = np.float32

# ---------------------------------------------------------------------------
# Palette (sRGB hex). Colour values are facts, taken from the project design tokens.
# ---------------------------------------------------------------------------
CHAR = "#111111"
CHAR_DEEP = "#0c0c0c"
CHAR_LIFT = "#1c1c1c"
PAPER = "#e8e6e3"
MUTED = "#8a8a86"
RED = "#e94248"
RED_LIGHT = "#e2363d"


def rgb(hex_color: str) -> np.ndarray:
    """'#rrggbb' -> float32 (3,) sRGB in 0..1."""
    h = hex_color.lstrip("#")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], dtype=F32) / 255.0


def srgb_to_linear(c):
    c = np.asarray(c, dtype=F32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(F32)


def linear_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=F32), 0.0, None)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055).astype(F32)


# ---------------------------------------------------------------------------
# Scalar helpers
# ---------------------------------------------------------------------------
def clamp01(x):
    return np.clip(x, 0.0, 1.0)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def smootherstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def ramp(t, stops):
    """Piecewise-linear colour ramp. stops = [(pos, '#hex'), ...]. Returns t.shape + (3,)."""
    pos = np.array([p for p, _ in stops], dtype=F32)
    cols = np.stack([rgb(c) for _, c in stops])
    t = np.asarray(t, dtype=F32)
    flat = t.reshape(-1)
    out = np.empty((flat.size, 3), dtype=F32)
    for ch in range(3):
        out[:, ch] = np.interp(flat, pos, cols[:, ch])
    return out.reshape(t.shape + (3,))


# ---------------------------------------------------------------------------
# Canvas
# ---------------------------------------------------------------------------
class Canvas:
    """Pixel grid in height units: x in [0, aspect], y in [0, 1] (y grows downwards)."""

    def __init__(self, w: int, h: int):
        self.w, self.h = int(w), int(h)
        self.aspect = self.w / self.h
        self.xs = ((np.arange(self.w, dtype=F32) + 0.5) / self.h).astype(F32)
        self.ys = ((np.arange(self.h, dtype=F32) + 0.5) / self.h).astype(F32)

    @property
    def x(self):
        return self.xs[None, :]

    @property
    def y(self):
        return self.ys[:, None]

    @property
    def pix(self) -> float:
        """One output pixel, in height units."""
        return 1.0 / self.h

    def ref(self, n: float) -> float:
        """``n`` pixels of a 4K master, in height units (scales with the output size)."""
        return n / 2160.0

    def px(self, n: float) -> float:
        """``n`` pixels at the *current* output size, in height units."""
        return n / self.h

    @property
    def u(self):
        """Normalised x in 0..1 (shape 1,W)."""
        return (self.xs / self.aspect)[None, :]

    @property
    def v(self):
        """Normalised y in 0..1 (shape H,1)."""
        return self.ys[:, None]

    def coverage(self, d):
        """Anti-aliased coverage from a signed distance (height units, negative inside)."""
        return np.clip(0.5 - d * self.h, 0.0, 1.0)


# ---------------------------------------------------------------------------
# Resampling / blur
# ---------------------------------------------------------------------------
def upscale(a: np.ndarray, w: int, h: int) -> np.ndarray:
    return cv2.resize(a, (w, h), interpolation=cv2.INTER_CUBIC)


def downscale(a: np.ndarray, w: int, h: int) -> np.ndarray:
    return cv2.resize(a, (w, h), interpolation=cv2.INTER_AREA)


def blur(a: np.ndarray, sigma_px: float) -> np.ndarray:
    """Gaussian blur (sigma in current-output pixels). Large sigmas go through a pyramid."""
    if sigma_px <= 0.05:
        return a
    f = int(max(1, sigma_px // 6))
    if f == 1:
        return cv2.GaussianBlur(a, (0, 0), sigma_px, borderType=cv2.BORDER_REFLECT)
    h, w = a.shape[:2]
    small = downscale(a, max(1, w // f), max(1, h // f))
    small = cv2.GaussianBlur(small, (0, 0), sigma_px / f, borderType=cv2.BORDER_REFLECT)
    return upscale(small, w, h)


def blur_xy(a: np.ndarray, sx: float, sy: float) -> np.ndarray:
    return cv2.GaussianBlur(a, (0, 0), sigmaX=max(sx, 1e-3), sigmaY=max(sy, 1e-3), borderType=cv2.BORDER_REFLECT)


def lowres_eval(c: Canvas, fn, factor: int, margin: float = 0.0):
    """Evaluate ``fn(x, y)`` on a coarse grid and cubic-upsample to the full canvas.

    ``fn`` receives broadcastable (1,w) and (h,1) float32 height-unit arrays and must
    return (h,w) or (h,w,k). ``margin`` extends the evaluated domain (height units) on
    every side; the returned array covers only the canvas.
    """
    wl = max(8, int(round(c.w / factor)))
    hl = max(8, int(round(c.h / factor)))
    xs = ((np.arange(wl, dtype=F32) + 0.5) / wl * c.aspect)[None, :]
    ys = ((np.arange(hl, dtype=F32) + 0.5) / hl)[:, None]
    return upscale(np.ascontiguousarray(fn(xs, ys), dtype=F32), c.w, c.h)


# ---------------------------------------------------------------------------
# Smooth random fields from plane waves (separable -> two BLAS matmuls)
# ---------------------------------------------------------------------------
@dataclass
class Waves:
    kx: np.ndarray
    ky: np.ndarray
    ph: np.ndarray
    amp: np.ndarray


def make_waves(rng, n, kmin, kmax, slope=1.3, angle=0.0, aniso=1.0) -> Waves:
    """Random plane waves approximating a smooth Gaussian field.

    Wavenumbers are in cycles per canvas height. ``slope`` is the spectral falloff
    (amplitude ~ k^-slope); ``aniso`` > 1 stretches features along ``angle`` (radians).
    """
    k = np.exp(rng.uniform(np.log(kmin), np.log(kmax), n)).astype(F32)
    th = rng.uniform(0, 2 * np.pi, n).astype(F32)
    kx = np.cos(th) * k
    ky = np.sin(th) * k
    if aniso != 1.0:
        ca, sa = np.cos(angle), np.sin(angle)
        ux, uy = kx * ca + ky * sa, -kx * sa + ky * ca  # rotate into the aniso frame
        ux = ux * aniso
        kx, ky = ux * ca - uy * sa, ux * sa + uy * ca
    amp = (k ** -slope).astype(F32)
    amp *= 1.0 / np.sqrt(np.sum(amp**2) / 2.0)  # unit std
    return Waves(
        (kx * 2 * np.pi).astype(F32),
        (ky * 2 * np.pi).astype(F32),
        rng.uniform(0, 2 * np.pi, n).astype(F32),
        amp.astype(F32),
    )


def eval_waves(xs, ys, w: Waves, grad: bool = False):
    """Evaluate the wave sum on the grid xs(W,) x ys(H,) -> (H,W) [+ gradient]."""
    xs = np.asarray(xs, dtype=F32).reshape(-1)
    ys = np.asarray(ys, dtype=F32).reshape(-1)
    a = np.outer(w.kx, xs) + w.ph[:, None]
    b = np.outer(w.ky, ys)
    sa, ca = np.sin(a), np.cos(a)
    sb, cb = np.sin(b), np.cos(b)
    amp = w.amp[:, None]
    f = (amp * cb).T @ sa + (amp * sb).T @ ca
    if not grad:
        return f.astype(F32)
    akx, aky = amp * w.kx[:, None], amp * w.ky[:, None]
    fx = (akx * cb).T @ ca - (akx * sb).T @ sa
    fy = (aky * cb).T @ ca - (aky * sb).T @ sa
    return f.astype(F32), fx.astype(F32), fy.astype(F32)


def eval_waves_pointwise(x, y, w: Waves):
    """Wave sum at arbitrary broadcast coordinates (needed after domain warping)."""
    x = np.asarray(x, dtype=F32)
    y = np.asarray(y, dtype=F32)
    out = np.zeros(np.broadcast(x, y).shape, dtype=F32)
    for i in range(len(w.amp)):
        out += w.amp[i] * np.sin(w.kx[i] * x + w.ky[i] * y + w.ph[i])
    return out


# ---------------------------------------------------------------------------
# Composition masks
# ---------------------------------------------------------------------------
def interest_mask(c: Canvas, left=(0.30, 0.55), corner=(0.66, 0.92), corner_v=(0.40, 0.05), floor=0.0):
    """1 where a wallpaper may be busy, 0 where widgets/clock sit (left ~40 %, top-right corner)."""
    u, v = c.u, c.v
    m = smoothstep(left[0], left[1], u) * (1.0 - smoothstep(corner[0], corner[1], u) * smoothstep(corner_v[0], corner_v[1], v))
    return (floor + (1.0 - floor) * m).astype(F32)


# ---------------------------------------------------------------------------
# Value-noise fields (resolution independent: the random grids depend only on the seed)
# ---------------------------------------------------------------------------
def fbm(rng, w: int, h: int, cells: float, octaves: int = 5, gain: float = 0.5, stretch: float = 1.0) -> np.ndarray:
    """Smooth fractal value noise (unit variance), shape (h, w).

    ``cells`` is the number of lattice cells along the canvas *height* in the first octave; ``stretch`` > 1
    makes features longer in x (it divides the horizontal cell count). Cubic-upsampled random grids.
    """
    out = np.zeros((h, w), dtype=F32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        gh = max(2, int(round(cells * 2.0**o)))
        gw = max(2, int(round(cells * 2.0**o * (w / h) / stretch)))
        grid = rng.standard_normal((gh, gw)).astype(F32)
        out += F32(amp) * cv2.resize(grid, (w, h), interpolation=cv2.INTER_CUBIC)
        norm += amp * amp
        amp *= gain
    return out / F32(np.sqrt(norm))


def disc_cover(r_px, dist_px):
    """Anti-aliased disc coverage from a radius and a centre distance, both in pixels."""
    return np.clip(r_px - dist_px + 0.5, 0.0, 1.0)


# ---------------------------------------------------------------------------
# Reeded / fluted glass: a row of cylindrical lenses
# ---------------------------------------------------------------------------
def lens_strips(n_px: int, pitch_px: float, curv: float):
    """Per-column lens coordinates for a row of cylindrical flutes."""
    p = np.arange(n_px, dtype=F32) + 0.5
    cell = np.floor(p / pitch_px)
    s = (p / pitch_px - cell) * 2.0 - 1.0
    centre = (cell + 0.5) * pitch_px
    return centre.astype(F32), s.astype(F32), (s + curv * s**3).astype(F32), cell.astype(F32)


def remap_axis(field: np.ndarray, src: np.ndarray, out_w: int, out_h: int, f: float, origin_px: float, axis: int):
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

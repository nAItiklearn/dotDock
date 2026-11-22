"""Dot renderers shared by every piece of site art.

All of them turn a *tone field* (float32, 0..1, "how much ink") into *coverage* (float32, 0..1, the
anti-aliased area covered by dots). Coverage is what the website uses as a CSS mask, so the page's own
theme colours paint it. Sizes are in output pixels; a piece is rendered at the width it is shown at times
its pixel ratio, and the pitch is given in CSS pixels times that ratio by the caller.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import cv2
import numpy as np

# Reuse the wallpaper engine's helpers (value noise, blur, smoothstep) instead of copying them.
_WPGEN = Path(__file__).resolve().parents[2] / "wallpaper-gen"
if str(_WPGEN) not in sys.path:
    sys.path.insert(0, str(_WPGEN))

from wpgen.core import F32, blur, fbm, smoothstep  # noqa: E402,F401

__all__ = ["F32", "blur", "fbm", "smoothstep", "halftone", "engrave", "lattice_dots", "diffuse", "box_tone", "cell_tone", "noise1d", "disc"]


def disc(r, d):
    """Anti-aliased coverage of a disc of radius ``r`` at distance ``d`` (pixels)."""
    return (np.clip(r - d + 0.5, 0.0, 1.0) * np.clip(r * 2.0, 0.0, 1.0)).astype(F32)


def box_tone(tone: np.ndarray, size_px: float) -> np.ndarray:
    """Average a tone field over roughly one dot cell, so a dot carries the tone of the area it replaces."""
    k = max(1, int(round(size_px)))
    return cv2.blur(tone, (k, k), borderType=cv2.BORDER_REFLECT)


def noise1d(rng, n: int, cells: float, octaves: int = 5, gain: float = 0.55) -> np.ndarray:
    """Smooth 1-D fractal noise of length ``n`` scaled into [-1, 1]."""
    out = np.zeros(n, dtype=F32)
    amp = 1.0
    for o in range(octaves):
        k = max(2, int(cells * 2**o))
        knots = rng.standard_normal((1, k)).astype(F32)
        out += amp * cv2.resize(knots, (n, 1), interpolation=cv2.INTER_CUBIC)[0]
        amp *= gain
    return out / (np.abs(out).max() + 1e-6)


def halftone(tone: np.ndarray, pitch: float, angle_deg: float = 45.0, rmax: float = 0.5, gamma: float = 0.5,
             floor: float = 0.0, origin: tuple[float, float] = (0.0, 0.0)) -> np.ndarray:
    """Classic halftone screen: a rotated square lattice whose dot area follows the tone.

    ``rmax`` is the dot radius at full tone as a fraction of the pitch (0.5 touches its neighbours),
    ``gamma`` 0.5 makes the dot *area* proportional to the tone. Tones under ``floor`` draw nothing.
    """
    h, w = tone.shape
    ca, sa = math.cos(math.radians(angle_deg)), math.sin(math.radians(angle_deg))
    xs = np.arange(w, dtype=F32) + 0.5 - origin[0]
    ys = np.arange(h, dtype=F32) + 0.5 - origin[1]
    u = xs[None, :] * ca + ys[:, None] * sa
    v = -xs[None, :] * sa + ys[:, None] * ca
    iu = np.floor(u / pitch)
    iv = np.floor(v / pitch)
    cu = (iu + 0.5) * pitch
    cv = (iv + 0.5) * pitch
    cx = cu * ca - cv * sa + origin[0]
    cy = cu * sa + cv * ca + origin[1]
    t = cv2.remap(box_tone(tone, pitch * 0.9), cx.astype(F32), cy.astype(F32), cv2.INTER_LINEAR,
                  borderMode=cv2.BORDER_REPLICATE)
    r = pitch * rmax * np.power(np.clip(t, 0.0, 1.0), gamma)
    cov = disc(r, np.hypot(u - cu, v - cv))
    return (cov * (t > floor)).astype(F32)


def engrave(tone: np.ndarray, pitch_y: float, pitch_x: float, rmax: float = 0.62, gamma: float = 0.6,
            floor: float = 0.02) -> np.ndarray:
    """Engraved lines: rows ``pitch_y`` apart, dots every ``pitch_x`` along them.

    With ``pitch_x`` well under ``pitch_y`` the dots of a dark row run together into a beaded line whose
    thickness follows the tone, which is how an engraver builds up a tone with parallel strokes.
    """
    h, w = tone.shape
    xs = np.arange(w, dtype=F32) + 0.5
    ys = np.arange(h, dtype=F32) + 0.5
    ix = np.floor(xs / pitch_x)
    iy = np.floor(ys / pitch_y)
    cx = (ix + 0.5) * pitch_x
    cy = (iy + 0.5) * pitch_y
    mx = np.broadcast_to(cx[None, :], (h, w)).astype(F32)
    my = np.broadcast_to(cy[:, None], (h, w)).astype(F32)
    k = max(1, int(round(pitch_y * 0.8)))
    t = cv2.remap(cv2.blur(tone, (max(1, int(round(pitch_x))), k), borderType=cv2.BORDER_REFLECT), mx, my,
                  cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    r = pitch_y * rmax * np.power(np.clip(t, 0.0, 1.0), gamma)
    dist = np.hypot((xs - cx)[None, :], (ys - cy)[:, None])
    return (disc(r, dist) * (t > floor)).astype(F32)


def diffuse(tone_cells: np.ndarray, radii: tuple[float, ...], seed: int = 0, strength: float = 0.9) -> np.ndarray:
    """Error-diffusion (serpentine Floyd-Steinberg) of a per-cell tone onto a few dot sizes.

    ``radii`` are dot radii as a fraction of the pitch, ascending, with 0.0 first (no dot). The tone each
    size stands for is its dot area (pi r^2, capped at the full cell). Returns the chosen radius per cell.
    Every grid cell keeps a dot or a gap, so the result is still a lattice of dots, not scattered noise.
    """
    rng = np.random.default_rng(seed)
    h, w = tone_cells.shape
    area = np.array([min(1.0, math.pi * r * r) for r in radii], dtype=np.float64)
    work = tone_cells.astype(np.float64).copy()
    work += rng.normal(0.0, 0.012, work.shape) * (work > 0.01)  # breaks up long straight runs of identical cells
    out = np.zeros((h, w), dtype=F32)
    rad = np.array(radii, dtype=F32)
    mid = (area[1:] + area[:-1]) / 2.0
    for y in range(h):
        left_to_right = (y % 2 == 0)
        xs = range(w) if left_to_right else range(w - 1, -1, -1)
        d = 1 if left_to_right else -1
        for x in xs:
            v = work[y, x]
            k = int(np.searchsorted(mid, v))
            out[y, x] = rad[k]
            err = (v - area[k]) * strength
            if 0 <= x + d < w:
                work[y, x + d] += err * 7 / 16
            if y + 1 < h:
                if 0 <= x - d < w:
                    work[y + 1, x - d] += err * 3 / 16
                work[y + 1, x] += err * 5 / 16
                if 0 <= x + d < w:
                    work[y + 1, x + d] += err * 1 / 16
    return out


def lattice_dots(radius_cells: np.ndarray, pitch: float, shape: tuple[int, int],
                 origin: tuple[float, float] = (0.0, 0.0)) -> np.ndarray:
    """Draw one disc per cell of an axis-aligned square lattice. ``radius_cells`` is in pixels."""
    h, w = shape
    ch, cw = radius_cells.shape
    xs = np.arange(w, dtype=F32) + 0.5 - origin[0]
    ys = np.arange(h, dtype=F32) + 0.5 - origin[1]
    ix = np.clip(np.floor(xs / pitch).astype(np.int32), 0, cw - 1)
    iy = np.clip(np.floor(ys / pitch).astype(np.int32), 0, ch - 1)
    dx = xs - (np.floor(xs / pitch) + 0.5) * pitch
    dy = ys - (np.floor(ys / pitch) + 0.5) * pitch
    r = radius_cells[iy[:, None], ix[None, :]]
    return disc(r, np.hypot(dx[None, :], dy[:, None]))


def cell_tone(tone: np.ndarray, pitch: float, origin: tuple[float, float] = (0.0, 0.0)) -> np.ndarray:
    """Mean tone under each cell of an axis-aligned lattice, as (rows, cells)."""
    h, w = tone.shape
    cw = int(math.ceil((w - origin[0]) / pitch))
    ch = int(math.ceil((h - origin[1]) / pitch))
    cx = ((np.arange(cw, dtype=F32) + 0.5) * pitch + origin[0])[None, :].repeat(ch, 0)
    cy = ((np.arange(ch, dtype=F32) + 0.5) * pitch + origin[1])[:, None].repeat(cw, 1)
    return cv2.remap(box_tone(tone, pitch), cx.astype(F32), cy.astype(F32), cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_REPLICATE)

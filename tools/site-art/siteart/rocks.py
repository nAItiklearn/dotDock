"""Boulders: a faceted solid (intersection of random planes, bent by noise), lit from the sun, then stippled.

The same lit height field is rendered two ways. ``dark`` is dense in the shadows (ink on paper) and
``light`` is dense in the lit faces (light dots on a dark page); the page picks one per theme so the
lighting always reads the right way round. ``body`` is the solid silhouette the page paints behind the
dots so the screen shot does not show through the gaps between them.
"""
from __future__ import annotations

import math

import cv2
import numpy as np

from .dots import F32, blur, cell_tone, diffuse, fbm, lattice_dots, smoothstep

SUN_DIR = np.array([0.55, -0.70, 0.46], dtype=F32)
SUN_DIR /= np.linalg.norm(SUN_DIR)


def _planes(rng, n: int):
    """Plane normals and offsets of a chunky, irregular solid (unit height half = 1)."""
    out = []
    # a few big faces toward the viewer and the sun, many smaller bevels round the rim
    for i in range(n):
        phi = rng.uniform(0.0, 2.0 * math.pi)
        if i < 4:
            z = rng.uniform(0.55, 0.95)
        elif i < n - 5:
            z = rng.uniform(0.10, 0.60)
        else:
            z = rng.uniform(-0.55, -0.10)  # back-facing planes bound the silhouette from behind
        r = math.sqrt(max(0.0, 1.0 - z * z))
        nv = np.array([r * math.cos(phi), r * math.sin(phi), z], dtype=F32)
        out.append((nv, 0.80 * (rng.uniform(0.62, 0.86) if z > 0.0 else rng.uniform(0.55, 0.78))))
    return out


def _height(rng, w: int, h: int, planes, ground: float):
    """Top surface Z and a 0..1 inside coverage over a (h, w) grid, units of half the height."""
    a = w / h
    xs = ((np.arange(w, dtype=F32) + 0.5) / h * 2.0 - a)[None, :]
    ys = ((np.arange(h, dtype=F32) + 0.5) / h * 2.0 - 1.0)[:, None]
    warp = 0.07
    wx = xs + warp * fbm(rng, w, h, 2.6, 4, 0.55)
    wy_pix = ys + warp * fbm(rng, w, h, 2.6, 4, 0.55)
    wy = wy_pix - 0.30                       # the solid sits low in the frame so its base reaches the ground
    top = np.full((h, w), 9.0, dtype=F32)
    bot = np.full((h, w), -9.0, dtype=F32)
    side_out = np.full((h, w), -1.0, dtype=F32)
    for nv, d in planes:
        rest = d - nv[0] * wx - nv[1] * wy
        if abs(float(nv[2])) < 1e-3:
            side_out = np.maximum(side_out, -rest)
        elif nv[2] > 0:
            np.minimum(top, rest / nv[2], out=top)
        else:
            np.maximum(bot, rest / nv[2], out=bot)
    # the flat bottom: the boulder sits on the ground, so everything below ``ground`` is cut off
    side_out = np.maximum(side_out, (wy_pix - ground))
    ell = 0.6 * (1.0 - (xs / (0.94 * a)) ** 2 - (ys / 0.94) ** 2)     # keeps the solid inside its frame
    gap = np.minimum(np.minimum(top - bot, -side_out), ell)
    inside = smoothstep(0.0, 0.035, gap)
    z = top + 0.035 * fbm(rng, w, h, 5.0, 3, 0.5) + 0.006 * fbm(rng, w, h, 26.0, 3, 0.55)
    return z.astype(F32), inside.astype(F32), gap.astype(F32)


def render_rock(width: int, height: int, scale: float, seed: int, planes: int = 11, ground: float = 0.80,
                pitch: float = 5.0):
    w, h = int(round(width * scale)), int(round(height * scale))
    rng = np.random.default_rng(seed)
    z, inside, gap = _height(rng, w, h, _planes(rng, planes), ground)
    zs = blur(z, 0.8 * scale)
    gy, gx = np.gradient(zs, 2.0 / h)
    n = np.stack([-gx, -gy, np.ones_like(gx)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    lam = np.clip(n @ SUN_DIR, 0.0, 1.0)
    lit = smoothstep(0.12, 0.92, lam)
    # concave places collect shadow, pits and cracks read as dark specks
    ao = np.clip(0.5 + 6.0 * (blur(zs, 5.0 * scale) - zs) / 0.05, 0.0, 1.0)
    pits = smoothstep(0.55, 0.85, fbm(rng, w, h, 38.0, 3, 0.6))
    crack = smoothstep(0.93, 1.0, 1.0 - np.abs(fbm(rng, w, h, 9.0, 3, 0.55))) * 0.8
    light = np.clip(0.10 + 0.90 * lit, 0.0, 1.0) * (0.72 + 0.28 * ao) * (1.0 - 0.22 * pits) * (1.0 - 0.55 * crack)
    rim = np.exp(-np.clip(gap, 0.0, None) / 0.05)               # a dense outline where the solid ends
    edge = rim * inside

    # a soft patch of dots on the ground under the boulder, so it sits instead of floating
    a = w / h
    xs = ((np.arange(w, dtype=F32) + 0.5) / h * 2.0 - a)[None, :]
    ys = ((np.arange(h, dtype=F32) + 0.5) / h * 2.0 - 1.0)[:, None]
    shadow = np.clip(1.0 - (xs / (0.92 * a)) ** 2 - ((ys - (ground + 0.045)) / 0.09) ** 2, 0.0, 1.0) ** 0.7 * (1.0 - inside)

    pitch = pitch * scale
    out = {"body": inside}
    for name, tone, ground_tone in (("dark", 1.0 - light, 0.60), ("light", light, 0.34)):
        body_tone = np.clip(tone * 0.95 + 0.45 * edge, 0.0, 1.0) * (inside > 0.04)
        tone = np.maximum(body_tone, ground_tone * shadow)
        cells = cell_tone(tone.astype(F32), pitch)
        radii = diffuse(cells, (0.0, 0.17, 0.27, 0.36, 0.45, 0.54), seed=seed + 5, strength=0.92)
        out[name] = lattice_dots(radii * pitch, pitch, (h, w))
    return out

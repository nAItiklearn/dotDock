"""Glass orbs: analytic ray-traced glass spheres refracting a dot lattice and one red glow.

Orthographic camera looking down at a plane. Each sphere sits on the plane; rays refract in,
cross the ball, refract out and land on the plane (inverted, magnified dots), with Fresnel
reflection of a small studio, dark rims, contact shadows and a caustic on the plane. The sphere
interiors are supersampled 3x3 so silhouettes and the refracted lattice stay clean.
"""
from __future__ import annotations

import numpy as np

from ..core import F32, Canvas, clamp01, linear_to_srgb, rgb, smoothstep, srgb_to_linear

IOR = 1.40
# (cx, cy, R) in height units; none of them overlap, all keep clear of the left 40 % and top-right corner
SPHERES = [
    (1.29, 0.60, 0.265),
    (0.96, 0.84, 0.140),
    (1.63, 0.83, 0.120),
    (1.04, 0.25, 0.062),
]


class _Scene:
    def __init__(self, c: Canvas, dark: bool):
        self.c, self.dark = c, dark
        self.pitch = 30.0 / 2160.0
        self.dot_r = 0.19 * self.pitch                  # dot radius: 0.19 of the pitch
        if dark:
            self.bg = srgb_to_linear(rgb("#0b0b0b"))
            self.glow = srgb_to_linear(rgb("#e94248")) * 1.15
            self.dot = srgb_to_linear(rgb("#ecebe8"))
        else:
            self.bg = srgb_to_linear(rgb("#e8e6e3"))
            self.glow = srgb_to_linear(rgb("#e2363d"))
            self.dot = srgb_to_linear(rgb("#141414"))

    def background(self, px, py, aa):
        """Plane colour (linear RGB) at points (px, py) in height units. ``aa`` = lattice edge softness."""
        c = self.c
        gx, gy = 1.40, 0.62
        g = np.exp(-(((px - gx) / 0.30) ** 2 + ((py - gy) / 0.24) ** 2) * 0.5)
        # keep the glow out of the left 40 % and the top-right corner
        u = px / c.aspect
        g = g * smoothstep(0.30, 0.62, u) * (1.0 - smoothstep(0.55, 0.85, u) * smoothstep(0.55, 0.10, py))
        g = g.astype(F32)
        p = self.pitch
        fx = (px / p + 0.5) % 1.0 - 0.5
        fy = (py / p + 0.5) % 1.0 - 0.5
        dist = np.sqrt(fx * fx + fy * fy) * p
        cov = np.clip((self.dot_r - dist) / max(aa, 1e-6) + 0.5, 0.0, 1.0)
        if self.dark:
            da = 0.030 + 0.75 * g ** 1.1
            col = self.bg + self.glow * (0.80 * g)[..., None]
            col = col + (self.dot * (da * cov)[..., None])
        else:
            da = 0.10 + 0.55 * g
            col = self.bg + (self.glow - self.bg) * (0.92 * g)[..., None]
            col = col + (self.dot - col) * (da * cov)[..., None]
        # contact + cast shadows and a caustic behind every sphere (light from the upper left)
        shade = np.zeros_like(g)
        caustic = np.zeros_like(g)
        for (cx, cy, R) in SPHERES:
            shade += 0.62 * np.exp(-(((px - cx - 0.50 * R) ** 2 + (py - cy - 0.42 * R) ** 2) / (2 * (0.80 * R) ** 2)))
            shade += 0.55 * np.exp(-(((px - cx - 0.06 * R) ** 2 + (py - cy - 0.05 * R) ** 2) / (2 * (0.42 * R) ** 2)))
            caustic += np.exp(-(((px - cx - 0.78 * R) ** 2 + (py - cy - 0.64 * R) ** 2) / (2 * (0.24 * R) ** 2)))
        shade = np.clip(shade, 0.0, 0.88)
        k = 0.40 if self.dark else 0.55
        col = col * (1.0 - k * shade)[..., None]
        white = self.dot if self.dark else self.bg
        col = col + white * (0.55 if self.dark else 0.18) * (caustic * np.clip(shade * 1.3, 0, 1))[..., None]
        return col.astype(F32)

    def env(self, rx, ry, rz):
        """Tiny studio: a soft window upper left, a thin strip on the right, dim room."""
        win = smoothstep(-0.78, -0.50, rx) * smoothstep(-0.12, -0.38, rx) * smoothstep(-0.80, -0.55, ry) * smoothstep(-0.12, -0.38, ry)
        strip = smoothstep(0.50, 0.56, rx) * smoothstep(0.66, 0.60, rx) * smoothstep(0.7, 0.4, np.abs(ry))
        room = 0.03 + 0.10 * smoothstep(0.8, -0.8, ry)
        if not self.dark:
            room = 0.30 + 0.35 * smoothstep(0.8, -0.8, ry)
        return (room + 7.0 * win + 2.2 * strip).astype(F32)


def _glass(scene: _Scene, px, py, cx, cy, R, aa):
    """Colour of the glass at sample points; returns (rgb_linear, inside_mask)."""
    dx, dy = (px - cx) / R, (py - cy) / R
    rho2 = dx * dx + dy * dy
    inside = rho2 < 1.0
    nz = np.sqrt(np.clip(1.0 - rho2, 0.0, 1.0))
    eta = 1.0 / IOR
    ck = np.sqrt(1.0 - eta * eta * (1.0 - nz * nz))
    a = eta * nz - ck
    tx, ty, tz = a * dx, a * dy, -eta + a * nz
    tn = tx * dx + ty * dy + tz * nz
    s = -2.0 * R * tn
    qx, qy, qz = R * dx + s * tx, R * dy + s * ty, R * nz + s * tz
    n2x, n2y, n2z = qx / R, qy / R, qz / R
    cos2 = n2x * tx + n2y * ty + n2z * tz
    k2 = 1.0 - IOR * IOR * (1.0 - cos2 * cos2)
    tir = k2 < 0.0
    ck2 = np.sqrt(np.clip(k2, 0.0, None))
    f = IOR * cos2 - ck2
    d2x, d2y, d2z = IOR * tx - f * n2x, IOR * ty - f * n2y, IOR * tz - f * n2z
    d2z = np.minimum(d2z, -0.08)
    tau = -(R + qz) / d2z
    hx, hy = cx + qx + d2x * tau, cy + qy + d2y * tau
    refr = scene.background(hx, hy, aa)

    # Fresnel (Schlick) and reflection of the studio
    fres = 0.04 + 0.96 * (1.0 - nz) ** 5
    rx, ry, rz = 2.0 * nz * dx, 2.0 * nz * dy, -1.0 + 2.0 * nz * nz
    refl = scene.env(rx, ry, rz)

    # grazing rays and total internal reflection see the dim room: dark glass rim
    rho = np.sqrt(rho2)
    rim = np.clip(smoothstep(0.84, 0.995, rho) ** 1.6 * 0.85 + tir * 1.0, 0.0, 1.0)
    room = (np.full(3, 0.05, dtype=F32) if scene.dark else scene.bg * 0.60)
    body = refr * (1.0 - rim)[..., None] + room * rim[..., None]
    body = body * np.array([0.97, 0.985, 1.0], dtype=F32)     # faint cool glass tint
    col = body * (1.0 - fres)[..., None] + (refl * fres)[..., None]
    # faint inner back-surface highlight on the side opposite the window
    back = np.exp(-(((dx - 0.42) ** 2 + (dy - 0.50) ** 2) / (2 * 0.16**2))) * smoothstep(0.55, 0.8, rho) * 0.5
    col = col + back[..., None] * (0.6 if scene.dark else 0.55)
    return col.astype(F32), inside


def _render(c: Canvas, mode: str, seed: int) -> np.ndarray:
    dark = mode == "dark"
    scene = _Scene(c, dark)
    img = scene.background(c.x + 0 * c.y, c.y + 0 * c.x, c.pix)          # (H, W, 3) linear

    n = 3
    offs = [(i + 0.5) / n - 0.5 for i in range(n)]
    for (cx, cy, R) in SPHERES:
        x0 = max(0, int((cx - R) * c.h) - 3)
        x1 = min(c.w, int((cx + R) * c.h) + 4)
        y0 = max(0, int((cy - R) * c.h) - 3)
        y1 = min(c.h, int((cy + R) * c.h) + 4)
        gx = (np.arange(x0, x1, dtype=F32) + 0.5)[None, :]
        gy = (np.arange(y0, y1, dtype=F32) + 0.5)[:, None]
        acc = np.zeros((y1 - y0, x1 - x0, 3), dtype=F32)
        for oy in offs:
            for ox in offs:
                px = (gx + ox) / c.h + 0 * gy
                py = (gy + oy) / c.h + 0 * gx
                col, inside = _glass(scene, px, py, cx, cy, R, c.pix / n)
                bgc = scene.background(px, py, c.pix / n)
                acc += np.where(inside[..., None], col, bgc)
        yy = (np.arange(y0, y1, dtype=F32) + 0.5)[:, None] / c.h - cy
        xx = (np.arange(x0, x1, dtype=F32) + 0.5)[None, :] / c.h - cx
        zone = (xx * xx + yy * yy) < (R + 3.0 / c.h) ** 2
        img[y0:y1, x0:x1] = np.where(zone[..., None], acc / (n * n), img[y0:y1, x0:x1])
    # tone-map the highlights softly, then to sRGB
    out = img / (1.0 + 0.18 * np.clip(img - 0.8, 0, None))
    return clamp01(linear_to_srgb(out))


from ..registry import Style  # noqa: E402

STYLES = [
    Style("glass-orbs", "Glass Orbs", "glass orbs", 4101,
          {"dark": "#e94248", "light": "#e2363d"}, _render, {"dark": 1.5, "light": 1.4}),
]

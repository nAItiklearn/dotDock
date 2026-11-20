"""Vignettes: low, wide pictures with one clear subject each, drawn in the hero flowers' craft.

Every subject is built from simple shapes on the supersampled canvas and reduced to the same mosaic of square
cells in four tones (pixel.py), so a horse, an octopus or a lily pad reads at a glance and still belongs to the
family. The subject stands in the middle of the strip with calm space on both sides; the narrow render keeps
it inside the middle 390 CSS pixels so a phone shows it whole.

Kinds: meadow (red poppies and tulips in grass), octopus (on the sea floor among weed), horse (standing in a
flowering field), pond (a dragonfly over lily pads), butterflies (over cosmos, with their dotted flight paths).
"""
from __future__ import annotations

import math

import numpy as np

from .dots import F32
from .pixel import (LIT, MID, Canvas, butterfly, cosmos, daisy, fish, grass, poppy, sparkle,
                    stem_with_leaves, tulip)

KINDS = ("meadow", "octopus", "horse", "pond", "butterflies")
CELL_WIDE, CELL_NARROW = 8.0, 6.0
LAYERS = ("stalk", "petal", "gold", "heart", "cloud")


# --- subjects ---------------------------------------------------------------------------------

def horse(cv: Canvas, x: float, y: float, size: float) -> None:
    """A horse standing in profile, facing left; (x, y) is the top-left of its box, ``size`` its length."""
    def p(u: float, v: float) -> tuple[float, float]:
        return (x + u * size, y + v * size)

    def stroke(points: list[tuple[float, float]], w0: float, w1: float, tone: float) -> None:
        a, b, c = (p(*q) for q in points)
        cv.curve("heart", a, b, c, w0 * size, w1 * size, tone)

    body = 0.66
    # Legs first, so the body overlaps their tops. The far pair is a shade darker than the near pair.
    for top, knee, hoof, tone in (((0.33, 0.50), (0.31, 0.70), (0.30, 0.92), 0.50),
                                  ((0.78, 0.48), (0.85, 0.68), (0.80, 0.92), 0.50),
                                  ((0.26, 0.50), (0.25, 0.72), (0.24, 0.94), body),
                                  ((0.72, 0.50), (0.76, 0.70), (0.72, 0.94), body)):
        stroke([top, knee, hoof], 0.062, 0.034, tone)
        hx, hy = p(*hoof)
        cv.polygon("heart", [(hx - 0.028 * size, hy - 0.02 * size), (hx + 0.028 * size, hy - 0.02 * size),
                             (hx + 0.032 * size, hy + 0.025 * size), (hx - 0.032 * size, hy + 0.025 * size)], 1.0)
    # Barrel, chest and hindquarters.
    cx, cy = p(0.52, 0.40)
    pts = [(cx + 0.30 * size * math.cos(a), cy + 0.135 * size * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 64)]
    cv.polygon("heart", pts, body)
    cv.disc("heart", *p(0.27, 0.40), 0.125 * size, body)
    cv.disc("heart", *p(0.77, 0.38), 0.13 * size, body)
    # Light on the back: a lighter crest along the top of the barrel and the croup.
    cv.disc("heart", *p(0.74, 0.34), 0.08 * size, 0.82)
    hl = [(p(0.52, 0.34)[0] + 0.22 * size * math.cos(a), p(0.52, 0.34)[1] + 0.055 * size * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 48)]
    cv.polygon("heart", hl, 0.82)
    # Neck rising to the head, the head angled down to the left.
    cv.polygon("heart", [p(0.17, 0.42), p(0.36, 0.33), p(0.24, 0.10), p(0.13, 0.06), p(0.08, 0.14)], body)
    cv.polygon("heart", [p(0.13, 0.03), p(0.19, 0.06), p(0.21, 0.13), p(0.12, 0.21), p(0.06, 0.29), p(0.015, 0.29),
                         p(0.005, 0.25), p(0.06, 0.12)], body)
    cv.disc("heart", *p(0.03, 0.265), 0.032 * size, body)                                                 # muzzle
    cv.lens("heart", *p(0.17, 0.05), math.radians(-70.0), 0.0, 0.05 * size, 0.03 * size, 1.0)        # ear
    cv.disc("gold", *p(0.12, 0.12), 0.016 * size, 1.0)                                                   # eye
    # Mane down the neck and the tail, at full strength.
    stroke([(0.15, 0.03), (0.27, 0.12), (0.33, 0.32)], 0.05, 0.035, 1.0)
    stroke([(0.90, 0.32), (1.00, 0.46), (0.96, 0.78)], 0.06, 0.02, 1.0)


def octopus(cv: Canvas, cx: float, cy: float, r: float, floor_y: float) -> None:
    """A round red octopus with its arms curling out on the sea floor at ``floor_y``; (cx, cy) is the centre of its head."""
    rng = cv.rng
    # Arms: each leaves the underside, sweeps down and out to the floor and curls up at its tip.
    for k, side in enumerate((-1, -1, -1, 1, 1, 1, -1, 1)):
        spread = (k % 3) / 2.0 if k < 6 else 0.1
        x0 = cx + side * r * (0.12 + 0.42 * spread)
        reach = r * (1.0 + 1.1 * spread)
        floor = floor_y - r * (0.10 + 0.12 * (1 - spread)) + rng.uniform(-0.05, 0.05) * r
        p0 = np.array((x0, cy + 0.7 * r))
        p1 = np.array((x0 + side * reach * 0.25, floor + 0.05 * r))
        p2 = np.array((x0 + side * reach, floor))
        rc = r * (0.30 - 0.06 * spread)
        centre = p2 + np.array((0.0, -rc))
        pts = []
        for t in np.linspace(0.0, 1.0, 30):
            pts.append(tuple((1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t ** 2 * p2))
        for u in np.linspace(0.0, 1.0, 22)[1:]:
            a = math.pi / 2 - side * u * 1.35 * math.pi
            rad = rc * (1.0 - 0.45 * u)
            pts.append((centre[0] + rad * math.cos(a), centre[1] + rad * math.sin(a)))
        tone = 0.70 if k >= 6 else 0.92
        n = len(pts) - 1
        for i, (px, py) in enumerate(pts):
            cv.disc("petal", px, py, r * (0.22 - 0.17 * i / n), tone)
        if k < 6:
            for i in range(8, 30, 6):
                px, py = pts[i]
                cv.disc("cloud", px, py + r * 0.08, r * 0.045, 1.0)
    # Head: a tall dome, lit from the upper left.
    head = [(cx + r * math.cos(a), cy + r * 1.08 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 72)]
    cv.polygon("petal", head, 0.80)
    cv.disc("petal", cx - 0.30 * r, cy - 0.35 * r, 0.52 * r, 1.0)
    cv.disc("petal", cx, cy + 0.55 * r, 0.62 * r, 0.80)
    for ex in (-0.36, 0.36):
        cv.disc("heart", cx + ex * r, cy + 0.32 * r, 0.16 * r, 1.0)
        cv.disc("cloud", cx + ex * r - 0.05 * r, cy + 0.26 * r, 0.06 * r, 1.0)


def lily_pad(cv: Canvas, cx: float, cy: float, r: float, notch: float) -> None:
    """A round leaf seen at a low angle (squashed), with a wedge cut out towards ``notch`` radians."""
    pts = [(cx, cy)]
    for a in np.linspace(notch + 0.35, notch + 2 * math.pi - 0.35, 60):
        pts.append((cx + r * math.cos(a), cy + 0.42 * r * math.sin(a)))
    cv.polygon("stalk", pts, 0.78)
    inner = [(cx - 0.2 * r + 0.55 * r * math.cos(a), cy - 0.08 * r + 0.22 * r * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 40)]
    cv.polygon("stalk", inner, 1.0)


def water_lily(cv: Canvas, cx: float, cy: float, r: float) -> None:
    """A cup of pointed red petals standing on a pad, the back row darker, with a golden heart."""
    for k, deg in enumerate((-150, -125, -100, -80, -55, -30)):
        cv.lens("petal", cx, cy, math.radians(deg), 0.05 * r, r * (0.95 if 1 < k < 4 else 0.8), 0.40 * r, 0.62)
    cv.disc("gold", cx, cy - 0.18 * r, 0.16 * r, 1.0)
    for k, deg in enumerate((-165, -135, -45, -15)):
        cv.lens("petal", cx, cy, math.radians(deg), 0.05 * r, r * 0.85, 0.42 * r, 0.95)
    cv.lens("petal", cx, cy, math.radians(-90), 0.0, r * 0.62, 0.40 * r, 0.95)


def ripple(cv: Canvas, cx: float, cy: float, r: float) -> None:
    """Two flat rings of fine dots on the water round a pad."""
    for k, rr in enumerate((1.0, 1.35)):
        n = int(46 * rr)
        for i in range(n):
            a = 2 * math.pi * i / n
            if abs(math.sin(a)) < 0.25 and math.cos(a) < 0:
                continue                                      # a gap where the light catches the water
            cv.disc("line", cx + r * rr * math.cos(a), cy + 0.30 * r * rr * math.sin(a), 1.1, 1.0 - 0.3 * k)


def big_dragonfly(cv: Canvas, cx: float, cy: float, size: float, tilt: float) -> None:
    """A dragonfly from above, wings spread, its long body angled by ``tilt`` radians; ``size`` is the wingspan."""
    ca, sa = math.cos(tilt), math.sin(tilt)

    def at(u: float, v: float) -> tuple[float, float]:
        return (cx + (u * ca - v * sa) * size, cy + (u * sa + v * ca) * size)

    for side in (-1, 1):
        for along, length, width, sweep in ((0.0, 0.50, 0.16, 0.30), (0.16, 0.46, 0.15, -0.34)):
            x, y = at(along, 0.0)
            a = tilt + side * (math.pi / 2 + sweep)
            cv.lens("cloud", x, y, a, 0.02 * size, length * size, width * size, 1.0)
            ex, ey = x + 0.85 * length * size * math.cos(a), y + 0.85 * length * size * math.sin(a)
            cv.disc("heart", ex, ey, 0.018 * size, 1.0)                     # the dark spot near each wing tip
    for i in range(12):
        u = -0.08 + 0.055 * i
        cv.disc("heart", *at(u, 0.0), (0.038 if i < 3 else 0.022) * size, 1.0)
    for e in (-1, 1):
        cv.disc("petal", *at(-0.11, 0.04 * e), 0.032 * size, 1.0)           # eyes


def flight_path(cv: Canvas, pts: list[tuple[float, float]]) -> None:
    """The dotted trail a butterfly leaves, as a smooth curve through ``pts``."""
    path = np.array(pts, dtype=F32)
    dense = []
    for i in range(len(path) - 1):
        p0, p1 = path[i], path[i + 1]
        c = (p0 + p1) / 2 + np.array([0.0, -40.0 if i % 2 == 0 else 40.0], dtype=F32)
        for t in np.linspace(0, 1, 60, endpoint=False):
            dense.append((1 - t) ** 2 * p0 + 2 * (1 - t) * t * c + t ** 2 * p1)
    for i in range(0, len(dense), 6):
        cv.disc("line", float(dense[i][0]), float(dense[i][1]), 1.3, 1.0)


def _tufts(cv: Canvas, rng: np.random.Generator, x0: float, x1: float, ground: float, height: float, n: int, width: float) -> None:
    for _ in range(n):
        x = rng.uniform(x0, x1)
        grass(cv, x, ground, height * rng.uniform(0.4, 1.0), rng.uniform(-0.25, 0.25) * height, width)


def _bloom_on_stem(cv: Canvas, rng: np.random.Generator, x: float, ground: float, height: float, r: float, kind: str) -> None:
    head = (x, ground - height)
    stem_with_leaves(cv, head, (x + rng.uniform(-6, 6), ground), rng.uniform(-14, 14), 0.10 * r + 1.6, (0.55,), 0.9 * r)
    (poppy if kind == "poppy" else cosmos)(cv, head[0], head[1], r)


# --- scenes -----------------------------------------------------------------------------------

def render_vignette(width: int, height: int, scale: float, seed: int, kind: str, narrow: bool) -> dict[str, np.ndarray]:
    """``width`` x ``height`` are CSS pixels; the arrays are ``scale`` times larger."""
    rng = np.random.default_rng(seed)
    cv = Canvas(width, height, scale, cell=CELL_NARROW if narrow else CELL_WIDE, rng=rng)
    g = cv.cell_css
    mid = width / 2
    # The span the subject may use: the middle of the strip, the phone width on narrow renders.
    half = 170.0 if narrow else 430.0
    ground = height * 0.92

    if kind == "meadow":
        xs = np.linspace(mid - half, mid + half, 7 if narrow else 11)
        for i, x in enumerate(xs):
            x += rng.uniform(-0.3, 0.3) * (xs[1] - xs[0])
            h = height * rng.uniform(0.42, 0.70)
            if i % 3 == 1:
                tulip(cv, int(x / g) - 2, int((ground - h * 0.75) / g))
                for yy in range(int((ground - h * 0.75) / g) + 4, int(ground / g)):
                    cv.fill_cell("stalk", int(x / g), yy, LIT)
            else:
                _bloom_on_stem(cv, rng, x, ground, h, (17.0 if narrow else 24.0) * rng.uniform(0.85, 1.1), "poppy")
        for k in range(4 if narrow else 7):
            daisy(cv, int(rng.uniform(mid - half, mid + half) / g), int(rng.uniform(0.80, 0.90) * height / g), 2.0)
        _tufts(cv, rng, mid - half * 1.15, mid + half * 1.15, height * 1.02, height * 0.22, 40 if narrow else 90, 0.8 * g)
        butterfly(cv, int((mid + half * 0.55) / g), int(height * 0.10 / g))
    elif kind == "octopus":
        r = 34.0 if narrow else 44.0
        ocx, ocy = mid, ground - 2.25 * r
        for side in (-1, 1):
            for k in range(2 if narrow else 3):
                bx = mid + side * (half * (0.62 + 0.16 * k))
                h = height * rng.uniform(0.45, 0.75)
                pts = cv.curve("stalk", (bx, ground), (bx + side * 18, ground - h * 0.5), (bx - side * 10, ground - h), 7.0, 2.5, 0.85)
                for i in range(8, len(pts) - 4, 9):
                    px, py = pts[i]
                    cv.lens("stalk", px, py, math.radians(-90 + (40 if (i // 9) % 2 else -40)), 0, 18, 7, 0.95)
        octopus(cv, ocx, ocy, r, ground)
        for k in range(0 if narrow else 4):
            cv.disc("cloud", ocx + r * (1.25 + 0.18 * (k % 2)), ocy - r * (0.4 + 0.45 * k), 3.0 + (k % 3), 1.0)
        if not narrow:
            fish(cv, int((mid - half * 0.75) / g), int(height * 0.18 / g), "gold")
            fish(cv, int((mid + half * 0.40) / g), int(height * 0.12 / g), "gold")
        for i in range(int((mid - half) / g), int((mid + half) / g)):
            if rng.random() < 0.55:
                cv.fill_cell("gold", i, int(ground / g) + 1, MID if rng.random() < 0.5 else LIT)
    elif kind == "horse":
        size = 230.0 if narrow else 300.0
        hx, hy = mid - size * 0.55, ground - size * 0.94 + 4
        horse(cv, hx, hy, size)
        for k in range(5 if narrow else 9):
            x = rng.uniform(mid - half, mid + half)
            if abs(x - mid) < size * 0.5:
                continue
            tulip(cv, int(x / g) - 2, int(rng.uniform(0.72, 0.84) * height / g))
        _tufts(cv, rng, mid - half * 1.1, mid + half * 1.1, height * 1.02, height * 0.16, 50 if narrow else 120, 0.8 * g)
        sun_x, sun_y = mid + half * 0.75, height * 0.18
        for j in range(-4, 5):
            for i in range(-4, 5):
                if math.hypot(i, j) <= 3.6:
                    cv.fill_cell("gold", int(sun_x / g) + i, int(sun_y / g) + j, LIT if i + j <= 0 else MID)
    elif kind == "pond":
        pads = ((-0.62, 0.80, 64, 0.4), (-0.18, 0.74, 84, 2.6), (0.32, 0.82, 72, 1.2), (0.76, 0.75, 54, 3.6))
        for k, (fx, fy, pr, notch) in enumerate(pads):
            if narrow and abs(fx) > 0.7:
                continue
            px, py = mid + fx * half, fy * height
            pr *= 0.55 if narrow else 1.0
            ripple(cv, px, py, pr * 1.15)
            lily_pad(cv, px, py, pr, notch)
            if k in (1, 2):
                water_lily(cv, px - pr * 0.1, py - pr * 0.05, pr * 0.55)
        big_dragonfly(cv, mid + half * 0.05, height * 0.28, 120.0 if narrow else 170.0, math.radians(-8.0))
        for _ in range(4 if narrow else 7):
            sparkle(cv, int(rng.uniform(mid - half, mid + half) / g), int(rng.uniform(0.05, 0.40) * height / g))
    else:  # butterflies
        flowers = (-0.7, -0.25, 0.2, 0.62) if not narrow else (-0.6, 0.05, 0.6)
        for k, fx in enumerate(flowers):
            _bloom_on_stem(cv, rng, mid + fx * half, ground, height * rng.uniform(0.35, 0.50), (15.0 if narrow else 21.0), "cosmos" if k % 2 else "poppy")
        _tufts(cv, rng, mid - half * 1.1, mid + half * 1.1, height * 1.02, height * 0.14, 40 if narrow else 80, 0.8 * g)
        flies = ((-0.85, 0.20), (-0.05, 0.10), (0.85, 0.24)) if not narrow else ((-0.75, 0.15), (0.70, 0.12))
        for k, (fx, fy) in enumerate(flies):
            bx, by = mid + fx * half, fy * height
            reach = 0.45 if narrow else 1.0
            way = 1 if k % 2 else -1
            trail = [(bx - 160 * way * reach, by + 70 * reach), (bx - 70 * way * reach, by + 20), (bx, by + 18)]
            flight_path(cv, trail)
            butterfly(cv, int(bx / g) - 4, int(by / g), gold_wings=bool(k % 2))

    out: dict[str, np.ndarray] = {name: cv.mosaic(name) for name in LAYERS}
    out["line"] = cv._coverage("line")
    silhouette = np.clip(sum(out[n] for n in (*LAYERS, "line")), 0.0, 1.0)
    out["grain"] = cv.stipple(silhouette, 5.0, 7.0, 3.4)
    return {k: v.astype(F32) for k, v in out.items()}

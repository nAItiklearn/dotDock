"""Living scenes: calm pixel pictures in layers the page moves on their own (website/src/components/LiveScene.astro).

Three scenes, each with its own subject, seed and palette roles, all in the download meadow's craft (vista.py):
halftone ground, flowers and animals reduced to square cells in four tones.

- ``paddock`` (home page): a horse grazing on a low hill. Its head, its tail and its body are separate pieces,
  so the head can lower to the grass and the tail can swish; grass and flowers lean in the wind in front.
- ``pond`` (Features page): lily pads and water lilies on still water, reeds and cattails at the sides, with
  rings of light on the water that come and go; the dragonflies are sprites that hover and dart.
- ``reef`` (Privacy page): an octopus on the sea floor among swaying weed. Its head and its arms are separate
  pieces so it can breathe and curl; fish swim across and bubbles rise.

Every piece is the full stage (WIDE or NARROW) so the layers line up; the pivot each moving part turns about is
exported with the scenes (``export``) so the page never hard-codes geometry. The narrow render keeps each
subject inside the middle 390 CSS pixels, where a phone shows it.
"""
from __future__ import annotations

import math
from typing import Callable

import numpy as np

from .dots import F32, halftone
from .pixel import LIT, MID, SHADE, grass, sparkle, stem_with_leaves
from .scape import _layer, _rolling
from .vignette import lily_pad, ripple, water_lily
from .vista import BIG, Tint, _canvas, _cell, no_repeat

Layers = dict[str, np.ndarray]

WIDE = (1920, 600)
NARROW = (720, 480)
VARIANTS = {"wide": WIDE, "narrow": NARROW}
CELL_LAYERS = ("stalk", "petal", "gold", "heart", "cloud", "pink", "violet", "apricot", "cream")
SUBJECT_HALF = {False: 470.0, True: 175.0}          # half the span a subject may use, CSS px


def _cells(cv, names=CELL_LAYERS) -> Layers:
    return {n: cv.mosaic(n).astype(F32) for n in names}


def _only(layers: Layers) -> Layers:
    return {k: v for k, v in layers.items() if v.max() > 0}


def _hills(width: int, height: int, scale: float, narrow: bool, seed: int, crests: tuple[float, float, float]) -> Layers:
    """Far, middle and near halftone ridges whose crests sit at the given fractions of the height."""
    w, h = int(round(width * scale)), int(round(height * scale))
    rng = np.random.default_rng(seed)
    waves = (0.7, 0.9, 1.2) if narrow else (1.1, 1.5, 2.0)
    lines = [
        crests[0] - 0.12 * _rolling(rng, width, 3, 0.2, waves[0]),
        crests[1] - 0.06 * _rolling(rng, width, 4, 0.6, waves[1]),
        crests[2] - 0.03 * _rolling(rng, width, 5, 0.3, waves[2]),
    ]
    specs = [(0.42, 5.5, 0.12, 0.42, 0.55, 8.0, 45.0, 0.04, "far"),
             (0.46, 6.5, 0.10, 0.38, 0.45, 7.0, 45.0, 0.05, "mid"),
             (0.62, 8.0, 0.50, 0.30, 0.18, 5.0, 45.0, 0.30, "near")]
    groups = {g: np.zeros((h, w), dtype=F32) for g in ("far", "mid", "near")}
    for line, spec in zip(lines, specs):
        line_px = np.interp(np.arange(w) / scale, np.arange(width), line).astype(F32)
        cov, inside = _layer(rng, w, h, scale, line_px, *spec[:-1])
        for g in groups.values():
            g *= 1.0 - inside
        groups[spec[-1]] += cov * inside
    return groups


def _flat(width: int, height: int, scale: float, top: float, bottom: float, tone: float, pitch: float) -> np.ndarray:
    """An even halftone field between two heights (fractions): still water, open sea or sand, one tone throughout."""
    w, h = int(round(width * scale)), int(round(height * scale))
    t = np.zeros((h, w), dtype=F32)
    t[int(top * h): int(bottom * h), :] = tone
    return halftone(t, pitch * scale, 45.0, rmax=0.56, gamma=0.55, floor=0.03)


def _specks(cv, width: int, height: int, y0: float, y1: float, n: int, colours: tuple[str, ...]) -> None:
    """Flowers far off: single cells of colour, and pairs on a stalk a little nearer."""
    rng = cv.rng
    g = cv.cell_css
    for _ in range(n):
        gx = int(rng.integers(1, int(width // g) - 2))
        t = rng.random() ** 0.8
        gy = int((y0 + (y1 - y0) * t) * height // g)
        colour = str(rng.choice(colours))
        cv.fill_cell(colour, gx, gy, MID if t < 0.5 else LIT)
        if t >= 0.5:
            cv.fill_cell("stalk", gx, gy + 1, SHADE)


def _front(cv, width: int, height: int, narrow: bool, half: int, seed: int, kinds: tuple[str, ...], n: int,
           blades: int, clear: tuple[float, float] | None = None) -> None:
    """Grass and a few big flowers along the foot of the picture, in two alternating sets (``half``)."""
    plan = np.random.default_rng(seed)
    picks = no_repeat(plan, kinds, n)
    for i, kind in enumerate(picks):
        fx = (i + 0.5 + plan.uniform(-0.3, 0.3)) / n
        depth = plan.random()
        fy = 0.80 + 0.10 * depth
        fr = (0.020 + 0.016 * depth) if narrow else (0.009 + 0.008 * depth)
        bend = plan.uniform(-0.02, 0.02)
        if clear and clear[0] < fx < clear[1]:
            continue
        if i % 2 != half:
            continue
        cx, cy, r = fx * width, fy * height, fr * width
        stem_with_leaves(cv, (cx, cy + 0.4 * r), (cx + bend * width, height * 1.02), bend * width * 0.5, 0.85 * cv.cell_css,
                         (0.45,), r * 0.9)
        BIG[kind](cv, cx, cy, r)
    for k in range(blades):
        u = plan.uniform(-0.01, 1.01)
        tall = plan.uniform(0.04, 0.13) * height
        lean = plan.uniform(-0.03, 0.012) * width
        if k % 2 == half:
            grass(cv, u * width, height * 1.02, tall, lean, 0.85 * cv.cell_css)


# --- the horse ----------------------------------------------------------------------------------------
# A horse in profile facing left, its head lowered to graze. (x, y) is the top-left of its box and ``size``
# its length; the parts are drawn on their own so the page can move the head and the tail.

def _horse_at(x: float, y: float, size: float) -> Callable[[float, float], tuple[float, float]]:
    return lambda u, v: (x + u * size, y + v * size)


HORSE_NECK = (0.30, 0.36)        # where the neck meets the withers: the head nods about it
HORSE_TAIL = (0.90, 0.32)        # the root of the tail: it swishes about it
_HORSE_BODY_TONE = 0.66


def horse_body(cv, x: float, y: float, size: float) -> None:
    p = _horse_at(x, y, size)

    def stroke(points, w0, w1, tone):
        a, b, c = (p(*q) for q in points)
        cv.curve("heart", a, b, c, w0 * size, w1 * size, tone)

    for top, knee, hoof, tone in (((0.33, 0.50), (0.31, 0.70), (0.30, 0.92), 0.50),
                                  ((0.78, 0.48), (0.85, 0.68), (0.80, 0.92), 0.50),
                                  ((0.26, 0.50), (0.25, 0.72), (0.24, 0.94), _HORSE_BODY_TONE),
                                  ((0.72, 0.50), (0.76, 0.70), (0.72, 0.94), _HORSE_BODY_TONE)):
        stroke([top, knee, hoof], 0.062, 0.034, tone)
        hx, hy = p(*hoof)
        cv.polygon("heart", [(hx - 0.028 * size, hy - 0.02 * size), (hx + 0.028 * size, hy - 0.02 * size),
                             (hx + 0.032 * size, hy + 0.025 * size), (hx - 0.032 * size, hy + 0.025 * size)], 1.0)
    cx, cy = p(0.52, 0.40)
    cv.polygon("heart", [(cx + 0.30 * size * math.cos(a), cy + 0.135 * size * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 64)],
               _HORSE_BODY_TONE)
    cv.disc("heart", *p(0.27, 0.40), 0.125 * size, _HORSE_BODY_TONE)
    cv.disc("heart", *p(0.77, 0.38), 0.13 * size, _HORSE_BODY_TONE)
    cv.disc("heart", *p(0.74, 0.34), 0.08 * size, 0.82)
    bx, by = p(0.52, 0.34)
    cv.polygon("heart", [(bx + 0.22 * size * math.cos(a), by + 0.055 * size * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 48)], 0.82)
    # The root of the neck stays with the body, so the head turns without a gap at the shoulder.
    cv.disc("heart", *p(*HORSE_NECK), 0.10 * size, _HORSE_BODY_TONE)


def horse_head(cv, x: float, y: float, size: float) -> None:
    """Neck reaching forward and down, the head low over the grass; a mane along the top of the neck."""
    p = _horse_at(x, y, size)
    cv.polygon("heart", [p(0.36, 0.30), p(0.38, 0.44), p(0.22, 0.52), p(0.12, 0.50), p(0.16, 0.36)], _HORSE_BODY_TONE)
    cv.polygon("heart", [p(0.17, 0.36), p(0.12, 0.48), p(0.06, 0.66), p(0.02, 0.70), p(-0.03, 0.66), p(0.00, 0.56),
                         p(0.08, 0.38)], _HORSE_BODY_TONE)
    cv.disc("heart", *p(-0.005, 0.675), 0.035 * size, _HORSE_BODY_TONE)                                    # muzzle
    cv.lens("heart", *p(0.12, 0.37), math.radians(-120.0), 0.0, 0.05 * size, 0.03 * size, 1.0)          # ear
    cv.disc("gold", *p(0.075, 0.47), 0.016 * size, 1.0)                                                    # eye
    a, b, c = p(0.14, 0.35), p(0.24, 0.30), p(0.35, 0.29)
    cv.curve("heart", a, b, c, 0.045 * size, 0.035 * size, 1.0)                                            # mane


def horse_tail(cv, x: float, y: float, size: float) -> None:
    p = _horse_at(x, y, size)
    a, b, c = p(*HORSE_TAIL), p(1.00, 0.46), p(0.96, 0.78)
    cv.curve("heart", a, b, c, 0.06 * size, 0.02 * size, 1.0)


def _horse_box(width: int, height: int, narrow: bool) -> tuple[float, float, float]:
    size = 250.0 if narrow else 330.0
    ground = height * 0.86
    return width / 2 - size * 0.45, ground - size * 0.94, size


# --- the octopus ----------------------------------------------------------------------------------------

def octopus_arms(cv, cx: float, cy: float, r: float, floor_y: float) -> None:
    """Eight arms leaving the underside, sweeping out along the floor and curling up at the tips."""
    rng = np.random.default_rng(907)
    for k, side in enumerate((-1, -1, -1, 1, 1, 1, -1, 1)):
        spread = (k % 3) / 2.0 if k < 6 else 0.1
        x0 = cx + side * r * (0.12 + 0.42 * spread)
        reach = r * (1.0 + 1.1 * spread)
        floor = floor_y - r * (0.10 + 0.12 * (1 - spread)) + rng.uniform(-0.05, 0.05) * r
        p0, p1, p2 = np.array((x0, cy + 0.7 * r)), np.array((x0 + side * reach * 0.25, floor + 0.05 * r)), np.array((x0 + side * reach, floor))
        rc = r * (0.30 - 0.06 * spread)
        centre = p2 + np.array((0.0, -rc))
        pts = [tuple((1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t ** 2 * p2) for t in np.linspace(0.0, 1.0, 30)]
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
                cv.disc("cream", px, py + r * 0.08, r * 0.045, 1.0)


def octopus_head(cv, cx: float, cy: float, r: float) -> None:
    """A tall dome lit from the upper left, two dark eyes with a glint."""
    cv.polygon("petal", [(cx + r * math.cos(a), cy + r * 1.08 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 72)], 0.80)
    cv.disc("petal", cx - 0.30 * r, cy - 0.35 * r, 0.52 * r, 1.0)
    cv.disc("petal", cx, cy + 0.55 * r, 0.62 * r, 0.80)
    for ex in (-0.36, 0.36):
        cv.disc("heart", cx + ex * r, cy + 0.32 * r, 0.16 * r, 1.0)
        cv.disc("cream", cx + ex * r - 0.05 * r, cy + 0.26 * r, 0.06 * r, 1.0)


def _octopus_place(width: int, height: int, narrow: bool) -> tuple[float, float, float, float]:
    r = 40.0 if narrow else 54.0
    floor = height * 0.86
    return width / 2, floor - 2.25 * r, r, floor


# --- sprites ----------------------------------------------------------------------------------------------

# A dragonfly in profile, flying right: W wing (two pairs, raised), B body in two tones by segment, T thorax,
# E the big eye. The wings are their own layer, so the page can beat them about their root.
_DRAGONFLY_SIDE = (".......WWWW..WWWW...",
                   "......WWWWWWWWWWWW..",
                   ".......WWWWWWWWWW...",
                   "BbBbBbBbBbBbTTTTTEE.",
                   ".BbBbBbBbBb.TTTTTEE.",
                   ".............T..T...")
DRAGONFLY_WING_ROOT = 3 / len(_DRAGONFLY_SIDE)     # the wings meet the body at the top of the body rows

# A small fish facing left: F body, f its shaded belly, T tail, E eye.
_FISH = ("..FFFF...",
         ".FFFFFF.T",
         "EFFFFFFTT",
         ".ffffff.T",
         "..ffff...")


def render_dragonfly(narrow: bool, scale: float) -> Layers:
    g = _cell(narrow)
    rows = _DRAGONFLY_SIDE
    cv = _canvas(int(len(rows[0]) * g), int(len(rows) * g), scale, narrow, 31)
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch == "W":
                cv.fill_cell("cloud", i, j, LIT if (i + j) % 3 else MID)
            elif ch in "Bb":
                cv.fill_cell("violet", i, j, LIT if ch == "B" else MID)
            elif ch == "T":
                cv.fill_cell("violet", i, j, SHADE)
            elif ch == "E":
                cv.fill_cell("heart", i, j, LIT)
    return _only(_cells(cv, ("cloud", "violet", "heart")))


def render_fish(colour: str, narrow: bool, scale: float) -> Layers:
    g = _cell(narrow)
    cv = _canvas(int(len(_FISH[0]) * g), int(len(_FISH) * g), scale, narrow, 41)
    for j, row in enumerate(_FISH):
        for i, ch in enumerate(row):
            if ch in "FT":
                cv.fill_cell(colour, i, j, LIT if ch == "F" else MID)
            elif ch == "f":
                cv.fill_cell(colour, i, j, SHADE)
            elif ch == "E":
                cv.fill_cell("heart", i, j, LIT)
    return _only(_cells(cv, (colour, "heart")))


def sprite_size(rows: tuple[str, ...], narrow: bool) -> tuple[int, int]:
    g = _cell(narrow)
    return int(len(rows[0]) * g), int(len(rows) * g)


# --- the scenes, piece by piece --------------------------------------------------------------------------

SEED_PADDOCK, SEED_POND, SEED_REEF = 1101, 1201, 1301


def paddock_land(width: int, height: int, scale: float, narrow: bool) -> Layers:
    hills = _hills(width, height, scale, narrow, SEED_PADDOCK, (0.42, 0.55, 0.70))
    cv = _canvas(width, height, scale, narrow, SEED_PADDOCK + 1)
    _specks(cv, width, height, 0.72, 0.82, 70 if narrow else 170, ("petal", "gold", "cream", "violet", "pink"))
    # A low sun of cells over the far hill, away from the horse.
    g = cv.cell_css
    sx, sy = width * (0.80 if narrow else 0.76), height * 0.20
    for j in range(-4, 5):
        for i in range(-4, 5):
            if math.hypot(i, j) <= 3.6:
                cv.fill_cell("gold", int(sx / g) + i, int(sy / g) + j, LIT if i + j <= 0 else MID)
    return {**hills, **_only(_cells(cv))}


def paddock_part(part: str):
    def render(width: int, height: int, scale: float, narrow: bool) -> Layers:
        cv = _canvas(width, height, scale, narrow, SEED_PADDOCK + 2)
        x, y, size = _horse_box(width, height, narrow)
        {"horse": horse_body, "head": horse_head, "tail": horse_tail}[part](cv, x, y, size)
        return _only(_cells(cv, ("heart", "gold")))
    return render


def paddock_sway(half: int):
    def render(width: int, height: int, scale: float, narrow: bool) -> Layers:
        cv = _canvas(width, height, scale, narrow, SEED_PADDOCK + 10 + half)
        x, _, size = _horse_box(width, height, narrow)
        clear = ((x - 0.05 * size) / width, (x + 1.05 * size) / width)            # nothing tall in front of the horse
        _front(cv, width, height, narrow, half, SEED_PADDOCK + 9, ("poppy", "daisy", "tulip", "cosmos", "cornflower"),
               8 if narrow else 16, 120 if narrow else 300, clear)
        return _only(_cells(cv))
    return render


def pond_land(width: int, height: int, scale: float, narrow: bool) -> Layers:
    hills = _hills(width, height, scale, narrow, SEED_POND, (0.36, 0.45, 0.52))
    hills.pop("near")
    water = _flat(width, height, scale, 0.55, 1.0, 0.34, 6.0)
    return {**hills, "sea": water}


def _pads(narrow: bool) -> tuple[tuple[float, float, float, float, bool], ...]:
    """(x as a share of the subject span, y as a share of the height, pad radius, notch angle, has a flower)."""
    pads = ((-0.86, 0.80, 52, 0.4, False), (-0.55, 0.70, 66, 2.6, True), (-0.18, 0.86, 84, 1.2, False),
            (0.14, 0.68, 58, 3.6, True), (0.46, 0.82, 74, 0.9, True), (0.80, 0.72, 50, 2.0, False))
    if narrow:
        pads = tuple(p for p in pads if abs(p[0]) < 0.6)
    return pads


def pond_pads(half: int):
    def render(width: int, height: int, scale: float, narrow: bool) -> Layers:
        cv = _canvas(width, height, scale, narrow, SEED_POND + 2 + half)
        span = SUBJECT_HALF[narrow] * (1.15 if narrow else 1.0)
        for k, (fx, fy, pr, notch, bloom) in enumerate(_pads(narrow)):
            if k % 2 != half:
                continue
            px, py = width / 2 + fx * span, fy * height
            pr *= 0.62 if narrow else 1.0
            lily_pad(cv, px, py, pr, notch)
            if bloom:
                water_lily(Tint(cv, {"petal": "pink" if k % 3 else "petal"}), px - pr * 0.1, py - pr * 0.05, pr * 0.55)
        return _only(_cells(cv))
    return render


def pond_ripples(half: int):
    def render(width: int, height: int, scale: float, narrow: bool) -> Layers:
        cv = _canvas(width, height, scale, narrow, SEED_POND + 4)
        span = SUBJECT_HALF[narrow] * (1.15 if narrow else 1.0)
        for k, (fx, fy, pr, _, _) in enumerate(_pads(narrow)):
            pr *= 0.62 if narrow else 1.0
            if k % 2 == half:
                ripple(Tint(cv, {"line": "cloud"}), width / 2 + fx * span, fy * height, pr * 1.2)
        return {"cloud": cv._coverage("cloud").astype(F32)}
    return render


def pond_reeds(half: int):
    """Reeds and cattails standing in the shallows at both sides of the water."""
    def render(width: int, height: int, scale: float, narrow: bool) -> Layers:
        cv = _canvas(width, height, scale, narrow, SEED_POND + 6 + half)
        plan = np.random.default_rng(SEED_POND + 5)
        n = 18 if narrow else 40
        for k in range(n):
            side = -1 if k % 2 == 0 else 1
            # A phone shows only the middle of the narrow render, so its reeds stand further in.
            edge = plan.uniform(0.15, 0.30) if narrow else plan.uniform(0.0, 0.16)
            x = (edge if side < 0 else 1.0 - edge) * width
            tall = plan.uniform(0.30, 0.62) * height
            lean = plan.uniform(-0.02, 0.01) * width
            cattail = plan.random() < 0.35
            if (k // 2) % 2 != half:
                continue
            pts = cv.curve("stalk", (x, height * 1.02), (x + lean * 0.3, height - tall * 0.6), (x + lean, height - tall),
                           0.8 * cv.cell_css, 0.3 * cv.cell_css, 0.9)
            if cattail:
                hx, hy = pts[-6]
                cv.lens("heart", hx, hy + 0.04 * tall, math.radians(-90 + 4), 0.0, 0.16 * tall, 1.2 * cv.cell_css, 1.0)
        return _only(_cells(cv))
    return render


def pond_glint(width: int, height: int, scale: float, narrow: bool) -> Layers:
    cv = _canvas(width, height, scale, narrow, SEED_POND + 8)
    g = cv.cell_css
    rng = cv.rng
    for _ in range(6 if narrow else 12):
        sparkle(cv, int(rng.uniform(0.2, 0.8) * width / g), int(rng.uniform(0.58, 0.95) * height / g), rng.random() < 0.3)
    return {"gold": cv.mosaic("gold").astype(F32)}


def reef_land(width: int, height: int, scale: float, narrow: bool) -> Layers:
    _, _, _, floor = _octopus_place(width, height, narrow)
    sea = _flat(width, height, scale, 0.0, floor / height, 0.26, 6.0)
    sand = _flat(width, height, scale, floor / height, 1.0, 0.40, 5.0)
    cv = _canvas(width, height, scale, narrow, SEED_REEF + 1)
    g = cv.cell_css
    rng = cv.rng
    # Shells and pebbles of colour on the sand, never grey stones.
    for _ in range(26 if narrow else 60):
        cv.fill_cell(str(rng.choice(("cream", "pink", "apricot"))), int(rng.uniform(0.02, 0.98) * width / g),
                     int(rng.uniform(floor / height + 0.03, 0.98) * height / g), MID if rng.random() < 0.5 else LIT)
    return {"sea": sea, "gold": sand, **_only(_cells(cv, ("cream", "pink", "apricot")))}


def reef_weed(half: int):
    """Tall wavy weed in two sets, with leaves along it, standing on the floor either side of the octopus."""
    def render(width: int, height: int, scale: float, narrow: bool) -> Layers:
        cv = _canvas(width, height, scale, narrow, SEED_REEF + 3 + half)
        cx, _, r, floor = _octopus_place(width, height, narrow)
        plan = np.random.default_rng(SEED_REEF + 2)
        n = 12 if narrow else 30
        for k in range(n):
            side = -1 if k % 2 == 0 else 1
            gap = (2.9 if narrow else 3.4) * r
            reach = (width / 2 - gap) * plan.random() ** 0.8
            x = cx + side * (gap + reach)
            tall = plan.uniform(0.28, 0.72) * height
            sway = plan.uniform(10, 26) * side
            colour = "stalk" if plan.random() < 0.8 else "apricot"
            if k % 4 // 2 != half:
                continue
            pts = cv.curve(colour, (x, floor + 4), (x + sway, floor - tall * 0.5), (x - sway * 0.5, floor - tall), 11.0, 5.0, 0.9)
            for i in range(8, len(pts) - 4, 10):
                px, py = pts[i]
                cv.lens(colour, px, py, math.radians(-90 + (45 if (i // 10) % 2 else -45)), 0, 24, 10, 0.95)
        return _only(_cells(cv))
    return render


def reef_part(part: str):
    def render(width: int, height: int, scale: float, narrow: bool) -> Layers:
        cv = _canvas(width, height, scale, narrow, SEED_REEF + 6)
        cx, cy, r, floor = _octopus_place(width, height, narrow)
        if part == "arms":
            octopus_arms(cv, cx, cy, r, floor)
        else:
            octopus_head(cv, cx, cy, r)
        return _only(_cells(cv, ("petal", "heart", "cream")))
    return render


# --- pivots the page turns parts about, as shares of the stage -------------------------------------------

def pivots() -> dict:
    out: dict = {}
    for variant, (w, h) in VARIANTS.items():
        narrow = variant == "narrow"
        x, y, size = _horse_box(w, h, narrow)
        cx, cy, r, floor = _octopus_place(w, h, narrow)
        out[variant] = {
            "paddock-head": [(x + HORSE_NECK[0] * size) / w, (y + HORSE_NECK[1] * size) / h],
            "paddock-tail": [(x + HORSE_TAIL[0] * size) / w, (y + HORSE_TAIL[1] * size) / h],
            "reef-head": [cx / w, (cy + 1.08 * r) / h],
            "reef-arms": [cx / w, floor / h],
        }
    return out


def export() -> dict:
    """What the page needs to know about the geometry: stage sizes, pivots and the dragonfly's wing root."""
    return {
        "stage": {k: list(v) for k, v in VARIANTS.items()},
        "cell": {"wide": _cell(False), "narrow": _cell(True)},
        "pivots": pivots(),
        "dragonflyWingRoot": DRAGONFLY_WING_ROOT,
    }


# --- registry (read by pieces.py) --------------------------------------------------------------------

_HALF_Q = {k: (78, 60) for k in ("far", "mid", "near", "sea")}
_CELL_Q = {k: (100, 100) for k in CELL_LAYERS}


def _scene(render: Callable[[int, int, float, bool], Layers]):
    def run(variant: str, w: int, h: int, scale: float) -> Layers:
        return render(w, h, scale, variant == "narrow")
    return run


def _sprite(render: Callable[[bool, float], Layers]):
    def run(variant: str, w: int, h: int, scale: float) -> Layers:
        return render(variant == "narrow", scale)
    return run


_SCENES: dict[str, tuple[int, Callable]] = {
    "live-paddock-land": (SEED_PADDOCK, paddock_land),
    "live-paddock-horse": (SEED_PADDOCK + 2, paddock_part("horse")),
    "live-paddock-head": (SEED_PADDOCK + 2, paddock_part("head")),
    "live-paddock-tail": (SEED_PADDOCK + 2, paddock_part("tail")),
    "live-paddock-sway-a": (SEED_PADDOCK + 10, paddock_sway(0)),
    "live-paddock-sway-b": (SEED_PADDOCK + 11, paddock_sway(1)),
    "live-pond-land": (SEED_POND, pond_land),
    "live-pond-pads-a": (SEED_POND + 2, pond_pads(0)),
    "live-pond-pads-b": (SEED_POND + 3, pond_pads(1)),
    "live-pond-ripples-a": (SEED_POND + 4, pond_ripples(0)),
    "live-pond-ripples-b": (SEED_POND + 4, pond_ripples(1)),
    "live-pond-reeds-a": (SEED_POND + 6, pond_reeds(0)),
    "live-pond-reeds-b": (SEED_POND + 7, pond_reeds(1)),
    "live-pond-glint": (SEED_POND + 8, pond_glint),
    "live-reef-land": (SEED_REEF, reef_land),
    "live-reef-weed-a": (SEED_REEF + 3, reef_weed(0)),
    "live-reef-weed-b": (SEED_REEF + 4, reef_weed(1)),
    "live-reef-arms": (SEED_REEF + 6, reef_part("arms")),
    "live-reef-head": (SEED_REEF + 6, reef_part("head")),
}

LIVE: dict[str, tuple[int, dict[str, tuple[int, int]], Callable, dict[str, tuple[int, int]]]] = {
    **{name: (seed, VARIANTS, _scene(render), _HALF_Q | _CELL_Q | {"gold": (90, 90) if name == "live-reef-land" else (100, 100)})
       for name, (seed, render) in _SCENES.items()},
    "live-dragonfly": (31, {"wide": sprite_size(_DRAGONFLY_SIDE, False), "narrow": sprite_size(_DRAGONFLY_SIDE, True)},
                       _sprite(render_dragonfly), _CELL_Q),
    **{
        f"live-fish-{colour}": (41, {"wide": sprite_size(_FISH, False), "narrow": sprite_size(_FISH, True)},
                                _sprite(lambda n, s, c=colour: render_fish(c, n, s)), _CELL_Q)
        for colour in ("gold", "apricot", "violet")
    },
}

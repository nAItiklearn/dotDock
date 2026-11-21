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
from PIL import Image, ImageDraw

from .dots import F32, halftone
from .pixel import LIT, MID, SHADE, grass, sparkle, stem_with_leaves
from .scape import _layer, _rolling
from .vignette import lily_pad, ripple, water_lily
from .vista import BIG, SPRITE_KINDS, Tint, _canvas, _cell, no_repeat, sprite

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
# A horse in profile facing left, grazing: an arched neck sloping down from the withers to a long head whose muzzle
# reaches the grass. It is drawn straight on the cell grid (no averaging), so the silhouette stays crisp: every
# shape is a polygon in cell units, a cell belongs to it when its centre is inside, and the tone follows the form
# (a lighter band along the top line, the far legs a shade lighter, mane, tail and hooves at full strength).
# The parts are separate pieces so the page can move them: the head and neck (with the mane and an ear), the
# tail. Coordinates are cells from the top-left of the horse's box; the hooves stand on row HORSE_GROUND.

HORSE_GROUND = 28
HORSE_COLS = 44
_CELL_SS = 4                      # samples per cell when testing which cells a polygon covers

Poly = list[tuple[float, float]]


def _circle(cx: float, cy: float, r: float, n: int = 24) -> Poly:
    return [(cx + r * math.cos(a), cy + r * math.sin(a)) for a in np.linspace(0, 2 * math.pi, n, endpoint=False)]


def _ellipse(cx: float, cy: float, rx: float, ry: float, n: int = 48) -> Poly:
    return [(cx + rx * math.cos(a), cy + ry * math.sin(a)) for a in np.linspace(0, 2 * math.pi, n, endpoint=False)]


def _grid(polys: list[Poly]) -> np.ndarray:
    """The cells (rows x cols of the horse's box) whose centres lie inside any of the polygons."""
    img = Image.new("1", (HORSE_COLS * _CELL_SS, (HORSE_GROUND + 1) * _CELL_SS), 0)
    draw = ImageDraw.Draw(img)
    for poly in polys:
        draw.polygon([(x * _CELL_SS, y * _CELL_SS) for x, y in poly], fill=1)
    full = np.asarray(img, dtype=bool)
    return full[_CELL_SS // 2::_CELL_SS, _CELL_SS // 2::_CELL_SS]


_BODY = [_ellipse(26.0, 11.0, 11.0, 4.6), _circle(16.4, 11.2, 4.3), _circle(35.0, 10.2, 4.6), _circle(19.0, 8.0, 2.2)]
_LEGS_NEAR = [
    [(14.6, 13), (18.2, 13), (17.6, 19.4), (17.2, 20.6), (17.0, 26.0), (15.6, 26.0), (15.6, 20.6), (15.0, 19.4)],
    _circle(16.4, 20.0, 1.15),                                                                   # the knee
    [(31.6, 12.5), (38.0, 12.0), (38.4, 16.0), (38.2, 19.4), (37.6, 20.6), (37.4, 26.0), (36.0, 26.0), (36.0, 20.8),
     (35.4, 19.0), (33.6, 16.0)],
    _circle(37.0, 20.2, 1.15),                                                                   # the hock
]
_LEGS_FAR = [
    [(18.0, 13), (20.6, 13), (19.8, 19.4), (19.2, 26.0), (17.9, 26.0), (18.3, 19.4)],
    [(29.8, 13), (33.4, 13), (34.4, 16.4), (34.6, 19.4), (34.0, 20.6), (33.6, 26.0), (32.4, 26.0), (32.6, 20.6), (31.6, 18.0)],
]
_HOOVES_NEAR = [[(15.1, 26.0), (17.5, 26.0), (17.8, 28.0), (14.8, 28.0)], [(35.6, 26.0), (37.8, 26.0), (38.1, 28.0), (35.3, 28.0)]]
_HOOVES_FAR = [[(17.6, 26.0), (19.6, 26.0), (19.9, 28.0), (17.3, 28.0)], [(32.0, 26.0), (34.0, 26.0), (34.3, 28.0), (31.7, 28.0)]]
_NECK = [(20.0, 7.0), (16.0, 6.7), (12.6, 8.6), (9.6, 12.0), (7.8, 15.6), (10.6, 17.6), (13.0, 14.6), (16.0, 12.6), (18.6, 12.2)]
_HEAD = [(7.9, 15.0), (5.3, 16.0), (3.9, 19.0), (2.7, 23.0), (1.7, 26.2), (3.6, 27.4), (5.6, 25.6), (7.8, 21.6), (10.6, 17.6)]
_MUZZLE = _circle(2.8, 26.2, 1.45)
_CHEEK = _circle(8.2, 18.2, 2.2)
_MANE = [(20.6, 6.0), (16.0, 5.6), (12.0, 7.6), (8.8, 11.4), (7.0, 15.0), (8.6, 15.4), (10.2, 12.2), (13.2, 9.0), (16.2, 7.2), (20.0, 7.6)]
_EAR = [(6.8, 15.8), (8.0, 12.6), (8.9, 15.2)]
_TAIL = [(38.0, 7.4), (40.8, 7.9), (42.0, 11.0), (42.2, 15.0), (41.6, 20.0), (40.6, 23.2), (39.4, 22.6), (39.8, 18.0),
         (39.8, 13.0), (38.6, 10.0)]
_EYE = (5, 18)
_NOSTRIL = (2, 26)

HORSE_NECK = (17.0, 9.5)          # where the neck leaves the withers: the head dips and lifts about it
HORSE_TAIL = (39.0, 8.0)          # the root of the tail: it sways about it


def _paint(cv, gx: int, gy: int, mask: np.ndarray, layer: str, tone: float, rim: float | None = None) -> None:
    """Fills the cells of ``mask``; with ``rim``, cells on the top line of the shape take that tone instead."""
    rows, cols = mask.shape
    for j in range(rows):
        for i in range(cols):
            if mask[j, i]:
                top = j == 0 or not mask[j - 1, i]
                cv.fill_cell(layer, gx + i, gy + j, rim if (rim is not None and top) else tone)


def _horse_origin(width: int, height: int, cell: float) -> tuple[int, int]:
    """The horse's box in cells: centred, its hooves on the meadow a little above the foot of the picture."""
    ground = height * 0.86
    return int(width / 2 / cell) - HORSE_COLS // 2, int(ground / cell) - HORSE_GROUND


def horse_part(cv, width: int, height: int, narrow: bool, part: str) -> None:
    gx, gy = _horse_origin(width, height, cv.cell_css)
    if part == "horse":
        _paint(cv, gx, gy, _grid(_LEGS_FAR), "heart", SHADE)
        _paint(cv, gx, gy, _grid(_HOOVES_FAR), "heart", MID)
        _paint(cv, gx, gy, _grid(_BODY + _LEGS_NEAR) & ~_grid(_HOOVES_NEAR), "heart", MID, rim=SHADE)
        _paint(cv, gx, gy, _grid(_HOOVES_NEAR), "heart", LIT)
    elif part == "head":                       # the head and neck, with the mane and the ear, dip and lift as one
        _paint(cv, gx, gy, _grid([_NECK, _HEAD, _MUZZLE, _CHEEK]) & ~_grid([_MANE]), "heart", MID)
        _paint(cv, gx, gy, _grid([_MANE]), "heart", LIT)
        _paint(cv, gx, gy, _grid([_EAR]) & ~_grid([_MANE]), "heart", LIT)
        cv.fill_cell("gold", gx + _EYE[0], gy + _EYE[1], LIT)
        cv.fill_cell("heart", gx + _NOSTRIL[0], gy + _NOSTRIL[1], LIT)
    else:
        _paint(cv, gx, gy, _grid([_TAIL]), "heart", LIT)


def horse_pivot(width: int, height: int, narrow: bool, at: tuple[float, float]) -> list[float]:
    cell = _cell(narrow)
    gx, gy = _horse_origin(width, height, cell)
    return [(gx + at[0]) * cell / width, (gy + at[1]) * cell / height]


def horse_span(width: int, height: int, narrow: bool) -> tuple[float, float]:
    """Left and right edges of the horse, as shares of the width, so nothing tall stands in front of it."""
    cell = _cell(narrow)
    gx, _ = _horse_origin(width, height, cell)
    return gx * cell / width, (gx + HORSE_COLS) * cell / width


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
_DRAGONFLY_SIDE = ("........WWW....WWW...",
                   ".......WWWWW..WWWWW..",
                   "........WWWWWWWWWW...",
                   "BbBbBbBbBbBbbTTTTTEE.",
                   "............TTTTTTEEE",
                   "............T..T..T..")
DRAGONFLY_WING_ROOT = 3 / len(_DRAGONFLY_SIDE)     # the wings meet the body at the top of the thorax

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
        horse_part(cv, width, height, narrow, part)
        layers = {"heart": cv.mosaic("heart").astype(F32)}
        if part == "head":
            layers["gold"] = cv.mosaic("gold").astype(F32)
        return layers
    return render


def paddock_sway(half: int):
    def render(width: int, height: int, scale: float, narrow: bool) -> Layers:
        cv = _canvas(width, height, scale, narrow, SEED_PADDOCK + 10 + half)
        left, right = horse_span(width, height, narrow)
        clear = (left - 0.02, right + 0.02)                                       # nothing tall in front of the horse
        _front(cv, width, height, narrow, half, SEED_PADDOCK + 9, ("poppy", "daisy", "tulip", "cosmos", "cornflower"),
               8 if narrow else 16, 120 if narrow else 300, clear)
        return _only(_cells(cv))
    return render


# --- the footer meadow -----------------------------------------------------------------------------------
# A meadow under the footer's wordmark, full of flowers from edge to edge. Depth sets the size: small pixel
# flowers on short stalks far back, then big round heads on tall leafy stems that grow larger and lower towards
# the front, with a few closed buds on thin stems, and clumps of grass between them. The near flowers come in two
# alternating sets, so the page can sway them out of step.

SEED_MEADOW = 1401
MEADOW_KINDS = ("poppy", "cornflower", "daisy", "tulip", "cosmos", "sunflower", "lily")
MEADOW_BUD = 0.18                  # share of the near flowers drawn as a closed bud instead of an open head


def meadow_land(width: int, height: int, scale: float, narrow: bool) -> Layers:
    hills = _hills(width, height, scale, narrow, SEED_MEADOW, (0.40, 0.54, 0.66))
    cv = _canvas(width, height, scale, narrow, SEED_MEADOW + 1)
    _specks(cv, width, height, 0.62, 0.80, 110 if narrow else 300, ("petal", "gold", "cream", "violet", "pink"))
    # Small pixel flowers on short stalks, in a loose band across the middle distance.
    rng = np.random.default_rng(SEED_MEADOW + 2)
    g = cv.cell_css
    n = 16 if narrow else 46
    kinds = no_repeat(rng, SPRITE_KINDS, n)
    for i, kind in enumerate(kinds):
        gx = int(((i + 0.5 + rng.uniform(-0.35, 0.35)) / n) * width / g)
        gy = int(height * rng.uniform(0.66, 0.78) / g)
        w, h = sprite(cv, kind, gx, gy)
        for k in range(int(rng.integers(2, 5))):
            cv.fill_cell("stalk", gx + w // 2, gy + h + k, MID)
    return {**hills, **_only(_cells(cv))}


def meadow_sway(half: int):
    def render(width: int, height: int, scale: float, narrow: bool) -> Layers:
        cv = _canvas(width, height, scale, narrow, SEED_MEADOW + 10 + half)
        plan = np.random.default_rng(SEED_MEADOW + 9)                    # both halves share one plan
        n = 15 if narrow else 38
        kinds = no_repeat(plan, MEADOW_KINDS, n)
        flowers = []
        for i, kind in enumerate(kinds):
            fx = (i + 0.5 + plan.uniform(-0.38, 0.38)) / n
            depth = plan.random()                                        # 0 at the back of the near field, 1 in front
            fy = 0.60 + 0.26 * depth
            fr = (0.018 + 0.026 * depth) if narrow else (0.008 + 0.012 * depth)
            bud = plan.random() < MEADOW_BUD
            flowers.append((kind, fx, fy, fr, plan.uniform(-0.025, 0.025), bud))
        flowers.sort(key=lambda f: f[2])                                 # far first, so nearer heads cover farther ones
        for i, (kind, fx, fy, fr, bend, bud) in enumerate(flowers):
            if i % 2 != half:
                continue
            cx, cy, r = fx * width, fy * height, fr * width
            if bud:                                                      # a closed bud stands taller, on a thin stem
                cy -= 1.6 * r
                r *= 0.55
                kind = "tulip"
            stem_with_leaves(cv, (cx, cy + 0.4 * r), (cx + bend * width, height * 1.02), bend * width * 0.5,
                             0.85 * cv.cell_css, (0.35, 0.65), r * 1.05)
            BIG[kind](cv, cx, cy, r)
        blades = 160 if narrow else 420
        clump = 0.5 + 0.5 * np.sin(np.linspace(0.0, (6.0 if narrow else 13.0) * math.pi, 512) + plan.uniform(0, math.pi))
        for k in range(blades):
            u = plan.uniform(-0.01, 1.01)
            c = float(clump[int(np.clip(u, 0.0, 0.999) * 511)])
            tall = plan.uniform(0.04, 0.08 + 0.12 * c) * height
            lean = plan.uniform(-0.03, 0.012) * width
            if k % 2 == half and plan.random() < 0.5 + 0.5 * c:
                grass(cv, u * width, height * 1.02, tall, lean, 0.85 * cv.cell_css)
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
        cx, cy, r, floor = _octopus_place(w, h, narrow)
        out[variant] = {
            "paddock-head": horse_pivot(w, h, narrow, HORSE_NECK),
            "paddock-tail": horse_pivot(w, h, narrow, HORSE_TAIL),
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
    "live-meadow-land": (SEED_MEADOW, meadow_land),
    "live-meadow-sway-a": (SEED_MEADOW + 10, meadow_sway(0)),
    "live-meadow-sway-b": (SEED_MEADOW + 11, meadow_sway(1)),
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

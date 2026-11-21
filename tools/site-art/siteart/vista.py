"""The download page's scenery: a wide meadow at golden hour, built in depth so the page can move it.

The picture is split into pieces that the page stacks and animates on their own:

- ``vista-land``: a low sun in a halftone halo, far and middle hills, the meadow plane, and the flowers of
  the middle distance: specks of colour far off, small cell flowers nearer, never the same flower twice in a
  row. It does not move.
- ``vista-clouds``: pixel clouds with a gold underside where the low sun lights them. They drift slowly.
- ``vista-glint-a`` / ``-b``: sparkles round the sun and over the field, twinkling in turn.
- ``vista-sway-a`` / ``-b``: the near grass and the big flowers in front, in two sets that lean in the wind
  out of step with each other.
- ``vista-butterfly-*``, ``vista-dragonfly``: single sprites that fly paths over the meadow.

Every piece has a wide (1920 x 640) and a narrow (720 x 480) render at the same aspect as the page box, and
uses the hero's craft: halftone ridges, flowers reduced to square cells in four tones. Colour layers are
named by role; the page paints them with theme tokens (styles/download.css). Besides the hero's roles
(petal, gold, heart, stalk, cloud, far, mid, near, grain) the meadow adds ``pink`` (cosmos), ``violet``
(cornflowers), ``apricot`` (lilies), ``cream`` (daisies) and ``glow`` (the sun).
"""
from __future__ import annotations

import math
from typing import Callable

import numpy as np
from PIL import Image, ImageDraw

from .dots import F32, halftone
from .pixel import LIT, MID, SHADE, SS, Canvas, _shade, butterfly, cell_stem, dragonfly, grass, lily, poppy, sparkle, stem_with_leaves, sunflower, cosmos
from .scape import _layer, _rolling

Layers = dict[str, np.ndarray]

WIDE = (1920, 640)
NARROW = (720, 480)
VARIANTS = {"wide": WIDE, "narrow": NARROW}
EXTRA = ("pink", "violet", "apricot", "cream", "glow")
FLOWER_LAYERS = ("petal", "gold", "pink", "violet", "apricot", "cream", "heart", "stalk")


def _cell(narrow: bool) -> float:
    return 6.0 if narrow else 8.0


def _canvas(width: int, height: int, scale: float, narrow: bool, seed: int) -> Canvas:
    cv = Canvas(width, height, scale, cell=_cell(narrow), rng=np.random.default_rng(seed))
    for name in EXTRA:
        cv.images[name] = Image.new("L", (cv.w * SS, cv.h * SS), 0)
        cv.draws[name] = ImageDraw.Draw(cv.images[name])
    return cv


class Tint:
    """A view of a canvas that paints one layer into another, so a red flower can be drawn in pink."""

    def __init__(self, cv: Canvas, remap: dict[str, str]) -> None:
        self._cv, self._remap = cv, remap

    def __getattr__(self, name: str):
        return getattr(self._cv, name)

    def _l(self, layer: str) -> str:
        return self._remap.get(layer, layer)

    def lens(self, layer, *a, **k):
        return self._cv.lens(self._l(layer), *a, **k)

    def disc(self, layer, *a, **k):
        return self._cv.disc(self._l(layer), *a, **k)

    def polygon(self, layer, *a, **k):
        return self._cv.polygon(self._l(layer), *a, **k)

    def fill_cell(self, layer, *a, **k):
        return self._cv.fill_cell(self._l(layer), *a, **k)


# --- the scene's geometry, shared by every piece so the sprites land on the right ground -------------

def _lines(width: int, narrow: bool, seed: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Crest rows (fractions of the height, per CSS column) of the far hills, the middle hills and the meadow."""
    rng = np.random.default_rng(seed)
    far = 0.45 - 0.18 * _rolling(rng, width, 3, 0.15, 0.7 if narrow else 1.15)
    mid = 0.53 - 0.08 * _rolling(rng, width, 4, 0.62, 0.9 if narrow else 1.6)
    field = 0.61 - 0.04 * _rolling(rng, width, 5, 0.33, 1.2 if narrow else 2.2)
    return far, mid, field


def _sun(width: int, height: int, narrow: bool) -> tuple[float, float, float]:
    """Centre and radius of the sun, in CSS pixels: low, sitting on the far hills, right of centre."""
    far, _, _ = _lines(width, narrow, SEED_LAND)
    x = (0.60 if narrow else 0.68) * width
    r = (0.085 if narrow else 0.058) * width
    crest = far[int(x)] * height
    return x, crest + 0.18 * r, r


SEED_LAND = 701


# --- flowers ------------------------------------------------------------------------------------------

# Small cell flowers. A LIT, B MID, C SHADE in the flower's own colour; G gold eye; H dark heart.
_SPRITES: dict[str, tuple[tuple[str, ...], str]] = {
    "poppy": ((".AAB.",
               "AAHBB",
               "ABBBC",
               ".BCC."), "petal"),
    "tulip": (("A.B.C",
               "AABCC",
               "AABBC",
               ".ABB."), "gold"),
    "cosmos": ((".A.B.",
                "AABBB",
                ".BGB.",
                "BBBCC",
                ".C.C."), "pink"),
    "cornflower": (("A.A.B",
                    ".AAB.",
                    "AABBC",
                    ".BHC."), "violet"),
    "daisy": ((".A.",
               "AGB",
               ".C."), "cream"),
    "lily": (("A...C",
              "AA.CC",
              ".ABC.",
              "..B.."), "apricot"),
}
_TONES = {"A": LIT, "B": MID, "C": SHADE}
SPRITE_KINDS = tuple(_SPRITES)


def sprite(cv: Canvas, kind: str, gx: int, gy: int) -> tuple[int, int]:
    """Draws a small flower with its top-left cell at (gx, gy); returns its (width, height) in cells."""
    rows, layer = _SPRITES[kind]
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch in _TONES:
                cv.fill_cell(layer, gx + i, gy + j, _TONES[ch])
            elif ch == "G":
                cv.fill_cell("gold", gx + i, gy + j, LIT)
            elif ch == "H":
                cv.fill_cell("heart", gx + i, gy + j, LIT)
    return len(rows[0]), len(rows)


def cornflower(cv: Canvas, cx: float, cy: float, r: float) -> None:
    """A ring of narrow violet florets, each with a forked tip, round a dark eye."""
    rng = cv.rng
    start = rng.uniform(0.0, 2.0 * math.pi)
    n = 9
    for k in range(n):
        a = start + 2.0 * math.pi * k / n + rng.normal(0.0, 0.05)
        tone = _shade(a, 0.60, 0.40)
        cv.lens("violet", cx, cy, a, 0.18 * r, 0.86 * r, 0.40 * r, tone)
        tx, ty = cx + 0.70 * r * math.cos(a), cy + 0.70 * r * math.sin(a)
        for fork in (-0.42, 0.42):
            cv.lens("violet", tx, ty, a + fork, 0.0, 0.36 * r, 0.20 * r, tone)
    cv.disc("heart", cx, cy, 0.22 * r, 1.0)


def big_tulip(cv: Canvas, cx: float, cy: float, r: float) -> None:
    """A closed cup of three upright petals; the head centre is (cx, cy)."""
    base = cy + 0.55 * r
    for off, tone in ((-1.0, 0.62), (1.0, 0.78), (0.0, 0.96)):
        cv.lens("petal", cx + off * 0.30 * r, base, -math.pi / 2 + off * 0.22, 0.0, 1.20 * r, 0.80 * r, tone)


def daisy_head(cv: Canvas, cx: float, cy: float, r: float) -> None:
    """Many slim cream petals round a domed golden eye."""
    start = cv.rng.uniform(0.0, 2.0 * math.pi)
    for k in range(16):
        a = start + 2.0 * math.pi * k / 16
        cv.lens("cream", cx, cy, a, 0.20 * r, r, 0.26 * r, _shade(a, 0.62, 0.38))
    cv.disc("gold", cx, cy, 0.28 * r, 1.0)


def _lily(cv: Canvas, cx: float, cy: float, r: float) -> None:
    lily(Tint(cv, {"line": "apricot"}), cx, cy, r)


def _cosmos(cv: Canvas, cx: float, cy: float, r: float) -> None:
    cosmos(Tint(cv, {"petal": "pink"}), cx, cy, r)


BIG: dict[str, Callable[[Canvas, float, float, float], None]] = {
    "poppy": poppy,
    "cosmos": _cosmos,
    "sunflower": sunflower,
    "cornflower": cornflower,
    "lily": _lily,
    "tulip": big_tulip,
    "daisy": daisy_head,
}


def no_repeat(rng: np.random.Generator, kinds: tuple[str, ...], n: int) -> list[str]:
    """``n`` kinds drawn at random, never the same kind twice in a row, and never three of one kind in a run of four."""
    out: list[str] = []
    for _ in range(n):
        banned = set(out[-1:]) | {k for k in kinds if out[-3:].count(k) >= 2}
        out.append(str(rng.choice([k for k in kinds if k not in banned])))
    return out


# --- pieces -------------------------------------------------------------------------------------------

def render_land(width: int, height: int, scale: float, narrow: bool) -> Layers:
    w, h = int(round(width * scale)), int(round(height * scale))
    rng = np.random.default_rng(SEED_LAND)
    far, mid, field = (np.interp(np.arange(w) / scale, np.arange(width), ln).astype(F32) for ln in _lines(width, narrow, SEED_LAND))
    # (line, tone, pitch, fall, rim, face, streak cells, angle, floor, colour group)
    specs = [
        (far, 0.42, 5.5, 0.12, 0.42, 0.55, 8.0, 45.0, 0.04, "far"),
        (mid, 0.46, 6.5, 0.10, 0.38, 0.45, 7.0, 45.0, 0.05, "mid"),
        (field, 0.62, 8.0, 0.50, 0.30, 0.18, 5.0, 45.0, 0.30, "near"),
    ]
    groups = {g: np.zeros((h, w), dtype=F32) for g in ("far", "mid", "near")}
    ground = np.zeros((h, w), dtype=F32)
    for spec in specs:
        cov, inside = _layer(rng, w, h, scale, *spec[:-1])
        for g in groups.values():
            g *= 1.0 - inside
        groups[spec[-1]] += cov * inside
        ground = np.maximum(ground, inside)

    # The sun: a near-solid disc in a halo of shrinking dots, set behind the far hills.
    sx, sy, sr = (v * scale for v in _sun(width, height, narrow))
    yy, xx = np.mgrid[0:h, 0:w].astype(F32)
    d = np.hypot(xx - sx, yy - sy) / sr
    tone = np.where(d < 1.0, 1.0, 0.46 * np.exp(-(d - 1.0) / 0.42)).astype(F32)
    glow = halftone(tone, 5.0 * scale, 45.0, rmax=0.62, gamma=0.55, floor=0.02) * (1.0 - ground)

    cv = _canvas(width, height, scale, narrow, SEED_LAND + 1)
    _field_flowers(cv, width, height, narrow, _lines(width, narrow, SEED_LAND)[2])
    flowers = {name: cv.mosaic(name) for name in FLOWER_LAYERS}
    return {"glow": glow.astype(F32), **groups, **{k: v.astype(F32) for k, v in flowers.items()}}


def _field_flowers(cv: Canvas, width: int, height: int, narrow: bool, field: np.ndarray) -> None:
    """Specks of colour in the distance, growing into small flowers on stems as the meadow comes closer."""
    rng = cv.rng
    g = cv.cell_css
    cols, rows = int(width // g), int(height // g)
    colours = ("petal", "gold", "pink", "violet", "apricot", "cream")
    last: dict[int, str] = {}
    taken: set[tuple[int, int]] = set()
    y_far, y_near = 0.03, 0.15                                       # specks: below the crest, as a fraction of the height
    n_specks = 110 if narrow else 230
    for _ in range(n_specks):
        gx = int(rng.integers(1, cols - 2))
        crest = field[min(width - 1, int(gx * g))]
        t = rng.random() ** 0.8                                     # more specks nearer the viewer
        gy = int((crest + y_far + (y_near - y_far) * t) * height // g)
        if any((gx + dx, gy + dy) in taken for dx in (-1, 0, 1, 2) for dy in (-1, 0, 1)):
            continue
        colour = str(rng.choice([c for c in colours if c != last.get(gy)]))
        last[gy] = colour
        if t < 0.45:
            cv.fill_cell(colour, gx, gy, MID)
            taken.add((gx, gy))
        else:
            cv.fill_cell(colour, gx, gy, LIT)
            cv.fill_cell(colour, gx + 1, gy, MID)
            cv.fill_cell("stalk", gx, gy + 1, SHADE)
            taken.update({(gx, gy), (gx + 1, gy), (gx, gy + 1)})

    # Small flowers on stems, in a band in front of the specks, evenly spread with a jitter.
    n = 13 if narrow else 30
    kinds = no_repeat(rng, SPRITE_KINDS, n)
    for i, kind in enumerate(kinds):
        gx = int(((i + 0.5 + rng.uniform(-0.3, 0.3)) / n) * cols)
        crest = field[min(width - 1, int(gx * g))]
        gy = int((crest + 0.16 + rng.uniform(0.0, 0.09)) * height // g)
        fw, fh = sprite(cv, kind, gx, gy)
        top = gy + fh
        cell_stem(cv, gx + fw // 2, top, gx + fw // 2 + int(rng.integers(-2, 3)), rows, (top + 3, top + 7))


def render_clouds(width: int, height: int, scale: float, narrow: bool) -> Layers:
    """Flat-bottomed clouds in a fine halftone, fuller at the top; the low sun lights their undersides in gold."""
    w, h = int(round(width * scale)), int(round(height * scale))
    rng = np.random.default_rng(SEED_LAND + 2)
    sx, _, _ = _sun(width, height, narrow)
    clouds = ((0.13, 0.13, 0.15, 5), (0.40, 0.08, 0.11, 4), (0.88, 0.17, 0.13, 5), (0.30, 0.29, 0.22, 3), (0.60, 0.23, 0.08, 3))
    if narrow:
        clouds = ((0.24, 0.11, 0.24, 4), (0.80, 0.18, 0.24, 4), (0.50, 0.29, 0.30, 3))
    img = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(img)
    bases = []
    for fx, fy, fw, lobes in clouds:
        cx, base, span = fx * width * scale, (fy + 0.05) * height * scale, fw * width * scale
        for k in range(lobes):
            t = (k + 0.5) / lobes
            lx = cx - span / 2 + span * t
            lr = span / lobes * (0.75 + 0.55 * math.sin(math.pi * t)) * rng.uniform(0.85, 1.1) * 0.62
            draw.ellipse((lx - lr, base - lr * 0.56 - lr, lx + lr, base - lr * 0.56 + lr), fill=255)
        draw.rectangle((0, base, w, base + span), fill=0)
        bases.append((cx, base, span))
    shape = np.asarray(img, dtype=F32) / 255.0
    yy = np.arange(h, dtype=F32)[:, None]
    cloud_t = np.zeros((h, w), dtype=F32)
    gold_t = np.zeros((h, w), dtype=F32)
    lip = 7.0 * scale                                                     # the lit underside, in pixels
    for cx, base, span in bases:
        x0, x1 = int(max(0, cx - span)), int(min(w, cx + span))
        sub = shape[:, x0:x1]
        top = base - 0.5 * span
        tone = np.clip(0.62 - 0.30 * (yy - top) / max(1.0, base - top), 0.25, 0.62)
        lit_side = np.clip(1.0 - np.abs((np.arange(x0, x1) / scale) - sx) / (0.6 * width), 0.15, 1.0)[None, :]
        under = ((yy > base - lip) & (yy <= base)).astype(F32)
        cloud_t[:, x0:x1] = np.maximum(cloud_t[:, x0:x1], sub * tone * (1.0 - under))
        gold_t[:, x0:x1] = np.maximum(gold_t[:, x0:x1], sub * under * 0.85 * lit_side)
    pitch = 4.0 * scale
    return {"cloud": halftone(cloud_t, pitch, 45.0, rmax=0.58, gamma=0.55, floor=0.05),
            "gold": halftone(gold_t, pitch, 45.0, rmax=0.58, gamma=0.55, floor=0.05)}


def render_glint(width: int, height: int, scale: float, narrow: bool, half: int) -> Layers:
    """Sparkles round the sun's rim and over the field; ``half`` 0 and 1 are two alternating sets."""
    cv = _canvas(width, height, scale, narrow, SEED_LAND + 3)
    g = cv.cell_css
    sx, sy, sr = _sun(width, height, narrow)
    _, _, field = _lines(width, narrow, SEED_LAND)
    spots = []
    for k, (a, d) in enumerate(((-2.4, 1.35), (-1.2, 1.55), (-0.3, 1.30), (-1.85, 2.05), (-0.75, 2.20), (-2.85, 1.85))):
        spots.append((sx + d * sr * math.cos(a), sy + d * sr * math.sin(a), k % 3 == 0))
    rng = cv.rng
    for _ in range(8 if narrow else 16):                                   # dew catching the light on the meadow
        x = rng.uniform(0.04, 0.96) * width
        spots.append((x, (field[int(x)] + rng.uniform(0.03, 0.12)) * height, False))
    for k, (x, y, big) in enumerate(spots):
        if k % 2 == half:
            sparkle(cv, int(x // g), int(y // g), big)
    return {"gold": cv.mosaic("gold").astype(F32)}


# The big flowers that frame the scene at its two sides, standing tall and close: (kind, x, head y, radius) as
# fractions of the width / height / width. The narrow render keeps them nearer the middle, where a phone shows it.
_FRAME = {
    False: (("cosmos", 0.035, 0.50, 0.040), ("poppy", 0.095, 0.62, 0.032), ("sunflower", 0.955, 0.47, 0.046), ("cornflower", 0.905, 0.63, 0.030)),
    True: (("cosmos", 0.25, 0.56, 0.060), ("sunflower", 0.76, 0.52, 0.068)),
}


def render_sway(width: int, height: int, scale: float, narrow: bool, half: int) -> Layers:
    """Grass blades and the big flowers in front; ``half`` 0 and 1 take alternate flowers and blades.

    The flowers are spread in depth: a head lower on the picture is nearer, so it is drawn larger, and a few
    tall ones close by frame the two sides.
    """
    cv = _canvas(width, height, scale, narrow, SEED_LAND + 10 + half)
    plan = np.random.default_rng(SEED_LAND + 9)                            # both halves share one plan
    n = 8 if narrow else 15
    kinds = no_repeat(plan, tuple(BIG), n)
    flowers = []
    for i, kind in enumerate(kinds):
        fx = (i + 0.5 + plan.uniform(-0.32, 0.32)) / n
        depth = plan.random()                                              # 0 far back in the near field, 1 at the front
        fy = 0.68 + 0.18 * depth
        fr = (0.022 + 0.024 * depth) if narrow else (0.011 + 0.014 * depth)
        flowers.append((kind, fx, fy, fr, plan.uniform(-0.03, 0.03)))
    for kind, fx, fy, fr in _FRAME[narrow]:
        flowers.append((kind, fx, fy, fr, plan.uniform(-0.02, 0.02)))
    flowers.sort(key=lambda f: f[2])                                       # far first, so nearer heads cover farther ones
    for i, (kind, fx, fy, fr, bend) in enumerate(flowers):
        if i % 2 != half:
            continue
        cx, cy, r = fx * width, fy * height, fr * width
        stem_with_leaves(cv, (cx, cy + 0.4 * r), (cx + bend * width, height * 1.02), bend * width * 0.5, 0.85 * cv.cell_css,
                         (0.40, 0.70), r * 0.95)
        BIG[kind](cv, cx, cy, r)
    # Grass in clumps: the blades are taller and denser where a slow noise along the foot is high.
    blades = 150 if narrow else 360
    clump = 0.5 + 0.5 * np.sin(np.linspace(0.0, (5.0 if narrow else 11.0) * math.pi, 512) + plan.uniform(0, math.pi))
    for k in range(blades):
        u = plan.uniform(-0.01, 1.01)
        c = float(clump[int(np.clip(u, 0.0, 0.999) * 511)])
        tall = plan.uniform(0.04, 0.10 + 0.16 * c) * height
        lean = plan.uniform(-0.035, 0.012) * width                        # the wind comes from the right
        keep = plan.random() < 0.45 + 0.55 * c
        if k % 2 == half and keep:
            grass(cv, u * width, height * 1.02, tall, lean, 0.85 * cv.cell_css)
    out = {name: cv.mosaic(name) for name in FLOWER_LAYERS}
    blooms = np.clip(sum(v for k, v in out.items() if k != "stalk"), 0.0, 1.0)
    out["grain"] = cv.stipple(blooms, 6.0, 8.0, 3.2)
    return {k: v.astype(F32) for k, v in out.items()}


_SPRITE_CELLS = {"butterfly": (9, 6), "dragonfly": (9, 9)}


def render_flyer(kind: str, narrow: bool, scale: float) -> Layers:
    cols, rows = _SPRITE_CELLS["dragonfly" if kind == "dragonfly" else "butterfly"]
    g = _cell(narrow)
    cv = _canvas(int(cols * g), int(rows * g), scale, narrow, SEED_LAND + 20)
    if kind == "dragonfly":
        dragonfly(cv, 0, 0)
    elif kind == "violet":
        butterfly(Tint(cv, {"petal": "violet"}), 0, 0)
    else:
        butterfly(cv, 0, 0, gold_wings=kind == "gold")
    out = {name: cv.mosaic(name) for name in ("petal", "gold", "violet", "heart", "cloud")}
    return {k: v.astype(F32) for k, v in out.items() if v.max() > 0}


def flyer_size(kind: str, narrow: bool) -> tuple[int, int]:
    cols, rows = _SPRITE_CELLS["dragonfly" if kind == "dragonfly" else "butterfly"]
    g = _cell(narrow)
    return int(cols * g), int(rows * g)


# --- registry (read by pieces.py) --------------------------------------------------------------------

_HALFTONE_Q = {k: (78, 60) for k in ("glow", "far", "mid", "near", "grain")}
_CELLS_Q = {k: (100, 100) for k in FLOWER_LAYERS + ("cloud", "violet")}


def _scene(render: Callable[[int, int, float, bool], Layers]):
    def run(variant: str, w: int, h: int, scale: float) -> Layers:
        return render(w, h, scale, variant == "narrow")
    return run


def _flyer(kind: str):
    def run(variant: str, w: int, h: int, scale: float) -> Layers:
        return render_flyer(kind, variant == "narrow", scale)
    return run


VISTA: dict[str, tuple[int, dict[str, tuple[int, int]], Callable, dict[str, tuple[int, int]]]] = {
    "vista-land": (SEED_LAND, VARIANTS, _scene(render_land), _HALFTONE_Q | _CELLS_Q),
    "vista-clouds": (SEED_LAND + 2, VARIANTS, _scene(render_clouds), {"cloud": (80, 70), "gold": (80, 70)}),
    "vista-glint-a": (SEED_LAND + 3, VARIANTS, _scene(lambda w, h, s, n: render_glint(w, h, s, n, 0)), {"gold": (100, 100)}),
    "vista-glint-b": (SEED_LAND + 3, VARIANTS, _scene(lambda w, h, s, n: render_glint(w, h, s, n, 1)), {"gold": (100, 100)}),
    "vista-sway-a": (SEED_LAND + 10, VARIANTS, _scene(lambda w, h, s, n: render_sway(w, h, s, n, 0)), _HALFTONE_Q | _CELLS_Q),
    "vista-sway-b": (SEED_LAND + 11, VARIANTS, _scene(lambda w, h, s, n: render_sway(w, h, s, n, 1)), _HALFTONE_Q | _CELLS_Q),
    **{
        f"vista-{'dragonfly' if kind == 'dragonfly' else 'butterfly-' + kind}": (
            SEED_LAND + 20, {"wide": flyer_size(kind, False), "narrow": flyer_size(kind, True)}, _flyer(kind),
            {k: (100, 100) for k in ("petal", "gold", "violet", "heart", "cloud")},
        )
        for kind in ("red", "gold", "violet", "dragonfly")
    },
}

"""Pixel flowers: drawn large, then reduced to a mosaic of square cells in a few tones.

Each flower is built from simple shapes (lens-shaped petals, discs, a phyllotaxis of seeds, curved
stems and leaves) on a supersampled canvas, one canvas per colour layer. ``Canvas.mosaic`` averages a
layer over a grid of square cells and snaps every cell to one of four tones, which is what gives the
blocky, pixel-art look; the tone steps are the shading. Single cells are scattered off the blooms like
petals blown loose, and a halftone stipple of the blooms' shadow is added on its own layer.
"""
from __future__ import annotations

import math

import cv2
import numpy as np
from PIL import Image, ImageDraw

from .dots import F32, blur, halftone

SS = 4
LEVELS = (0.50, 0.68, 0.85, 1.0)
THRESHOLDS = (0.16, 0.36, 0.58, 0.80)
LIGHT_ANGLE = math.radians(-125.0)             # light comes from the upper left
GOLDEN_ANGLE = math.pi * (3.0 - math.sqrt(5.0))

LAYERS = ("stalk", "petal", "gold", "heart", "cloud")


class Canvas:
    """A set of supersampled layer canvases. Coordinates are CSS pixels; ``scale`` is the pixel ratio."""

    def __init__(self, width: int, height: int, scale: float, cell: float, rng: np.random.Generator) -> None:
        self.scale = scale
        self.w, self.h = int(round(width * scale)), int(round(height * scale))
        self.cell = max(2, int(round(cell * scale)))
        self.rng = rng
        self.images = {name: Image.new("L", (self.w * SS, self.h * SS), 0) for name in LAYERS}
        self.draws = {name: ImageDraw.Draw(img) for name, img in self.images.items()}

    # --- drawing primitives -------------------------------------------------------------------

    def _px(self, v: float) -> float:
        return v * self.scale * SS

    def polygon(self, layer: str, pts: list[tuple[float, float]], tone: float) -> None:
        self.draws[layer].polygon([(self._px(x), self._px(y)) for x, y in pts], fill=int(255 * min(1.0, tone)))

    def disc(self, layer: str, cx: float, cy: float, r: float, tone: float) -> None:
        x, y, rr = self._px(cx), self._px(cy), self._px(r)
        self.draws[layer].ellipse((x - rr, y - rr, x + rr, y + rr), fill=int(255 * min(1.0, tone)))

    def lens(self, layer: str, x: float, y: float, angle: float, r_in: float, r_out: float, width: float, tone: float) -> None:
        """A pointed petal or leaf starting ``r_in`` from (x, y) and reaching ``r_out``, ``width`` across."""
        t = np.linspace(0.0, 1.0, 18)
        along = r_in + (r_out - r_in) * t
        half = 0.5 * width * np.sin(np.pi * t) ** 0.75
        ca, sa = math.cos(angle), math.sin(angle)
        left = [(x + a * ca - hw * sa, y + a * sa + hw * ca) for a, hw in zip(along, half)]
        right = [(x + a * ca + hw * sa, y + a * sa - hw * ca) for a, hw in zip(along[::-1], half[::-1])]
        self.polygon(layer, left + right, tone)

    def curve(self, layer: str, p0, p1, p2, width0: float, width1: float, tone: float = 1.0) -> list[tuple[float, float]]:
        """A tapering stroke along a quadratic bezier; returns the points so leaves can sit on it."""
        n = 48
        ts = np.linspace(0.0, 1.0, n)[:, None]
        pts = (1 - ts) ** 2 * np.asarray(p0) + 2 * (1 - ts) * ts * np.asarray(p1) + ts**2 * np.asarray(p2)
        for i, (x, y) in enumerate(pts):
            self.disc(layer, x, y, 0.5 * (width0 + (width1 - width0) * i / (n - 1)), tone)
        return [(float(x), float(y)) for x, y in pts]

    def loose_cells(self, layer: str, cx: float, cy: float, r: float, count: int, reach: float = 1.9) -> None:
        """Whole cells scattered round a bloom, thinning out with distance."""
        cell = self.cell / self.scale
        for _ in range(count):
            d = r * (1.08 + (reach - 1.08) * self.rng.random() ** 1.6)
            a = self.rng.uniform(0.0, 2.0 * math.pi)
            gx = round((cx + d * math.cos(a)) / cell) * cell
            gy = round((cy + d * math.sin(a)) / cell) * cell
            tone = self.rng.choice((0.55, 0.75, 1.0))
            self.polygon(layer, [(gx, gy), (gx + cell, gy), (gx + cell, gy + cell), (gx, gy + cell)], tone)

    # --- cell sprites (small flowers are drawn cell by cell so every one reads clearly) -------------

    @property
    def cell_css(self) -> float:
        return self.cell / self.scale

    def fill_cell(self, layer: str, gx: int, gy: int, tone: float) -> None:
        g = self.cell_css
        self.polygon(layer, [(gx * g, gy * g), ((gx + 1) * g, gy * g), ((gx + 1) * g, (gy + 1) * g), (gx * g, (gy + 1) * g)], tone)

    # --- reduction ----------------------------------------------------------------------------

    def _coverage(self, name: str) -> np.ndarray:
        arr = np.asarray(self.images[name], dtype=F32) / 255.0
        return cv2.resize(arr, (self.w, self.h), interpolation=cv2.INTER_AREA)

    def mosaic(self, name: str) -> np.ndarray:
        """The layer as square cells in four tones; cells with almost no paint are dropped."""
        cov = self._coverage(name)
        c = self.cell
        rows, cols = -(-self.h // c), -(-self.w // c)
        pad = np.zeros((rows * c, cols * c), dtype=F32)
        pad[: self.h, : self.w] = cov
        tone = pad.reshape(rows, c, cols, c).mean(axis=(1, 3))
        tone = tone + self.rng.normal(0.0, 0.045, tone.shape).astype(F32) * (tone > 0.05)
        out = np.zeros_like(tone)
        for level, thr in zip(LEVELS, THRESHOLDS):
            out[tone >= thr] = level
        full = np.kron(out, np.ones((c, c), dtype=F32))
        return full[: self.h, : self.w]

    def stipple(self, silhouette: np.ndarray, dx: float, dy: float, pitch: float) -> np.ndarray:
        """A halftone of the shadow the blooms would throw down and to the right of themselves."""
        s = self.scale
        shifted = np.zeros_like(silhouette)
        ox, oy = int(round(dx * s)), int(round(dy * s))
        shifted[oy:, ox:] = silhouette[: self.h - oy, : self.w - ox]
        shade = np.clip(blur(shifted, 5.0 * s) * 1.6, 0.0, 1.0) * (1.0 - np.clip(silhouette * 2.0, 0.0, 1.0))
        return halftone(shade.astype(F32), pitch * s, 45.0, rmax=0.5, gamma=0.7, floor=0.06)


# --- flowers ----------------------------------------------------------------------------------

def _shade(angle: float, base: float = 0.62, span: float = 0.38) -> float:
    return base + span * max(0.0, math.cos(angle - LIGHT_ANGLE))


def sunflower(cv: Canvas, cx: float, cy: float, r: float) -> None:
    """Two rings of golden petals round a dark disc of seeds."""
    rng = cv.rng
    n = 21
    for ring, (reach, width, turn) in enumerate(((1.0, 0.36, 0.0), (0.84, 0.34, 0.5))):
        for k in range(n):
            a = 2.0 * math.pi * (k + turn) / n + rng.normal(0.0, 0.05)
            tone = _shade(a, 0.58 + 0.10 * ring, 0.34) * rng.uniform(0.9, 1.0)
            cv.lens("gold", cx, cy, a, 0.30 * r, r * reach * rng.uniform(0.94, 1.04), r * width, tone)
    cv.disc("heart", cx, cy, 0.42 * r, 1.0)
    for i in range(1, 110):
        d = 0.42 * r * math.sqrt(i / 110.0)
        a = i * GOLDEN_ANGLE
        cv.disc("heart", cx + d * math.cos(a), cy + d * math.sin(a), 0.032 * r, 0.42)


def poppy(cv: Canvas, cx: float, cy: float, r: float) -> None:
    """A cup of overlapping round red petals with a dark eye and a ring of stamens."""
    rng = cv.rng
    start = rng.uniform(0.0, 2.0 * math.pi)
    for k in range(5):
        a = start + 2.0 * math.pi * k / 5
        cv.disc("petal", cx + 0.46 * r * math.cos(a), cy + 0.46 * r * math.sin(a), 0.62 * r, _shade(a, 0.66, 0.34))
    for k in range(4):
        a = start + math.pi / 5 + 2.0 * math.pi * k / 4
        cv.disc("petal", cx + 0.30 * r * math.cos(a), cy + 0.30 * r * math.sin(a), 0.42 * r, _shade(a, 0.80, 0.20))
    cv.disc("heart", cx, cy, 0.15 * r, 1.0)
    for k in range(10):
        a = 2.0 * math.pi * k / 10
        cv.disc("heart", cx + 0.27 * r * math.cos(a), cy + 0.27 * r * math.sin(a), 0.045 * r, 0.9)


def cosmos(cv: Canvas, cx: float, cy: float, r: float) -> None:
    """Eight broad petals round a small golden eye."""
    start = cv.rng.uniform(0.0, 2.0 * math.pi)
    for k in range(8):
        a = start + 2.0 * math.pi * k / 8
        cv.lens("petal", cx, cy, a, 0.10 * r, r, 0.56 * r, _shade(a, 0.60, 0.40))
    cv.disc("gold", cx, cy, 0.20 * r, 1.0)


FLOWERS = {"sunflower": sunflower, "poppy": poppy, "cosmos": cosmos}


def stem_with_leaves(cv: Canvas, head: tuple[float, float], base: tuple[float, float], bend: float,
                     width: float, leaves: tuple[float, ...], leaf_len: float) -> None:
    """A stem from a flower head down to ``base``, bowed sideways by ``bend``, with leaves at the given heights."""
    (hx, hy), (bx, by) = head, base
    ctrl = ((hx + bx) / 2.0 + bend, (hy + by) / 2.0 + (by - hy) * 0.18)
    pts = cv.curve("stalk", (hx, hy), ctrl, (bx, by), width, width)
    for i, t in enumerate(leaves):
        x, y = pts[min(len(pts) - 1, int(t * (len(pts) - 1)))]
        side = -1.0 if i % 2 == 0 else 1.0
        cv.lens("stalk", x, y, math.radians(-90.0 + side * 52.0 + cv.rng.normal(0.0, 6.0)), 0.0, leaf_len, leaf_len * 0.34, 0.82)


def grass(cv: Canvas, x: float, y: float, height: float, lean: float, width: float) -> None:
    cv.curve("stalk", (x, y), (x + lean * 0.25, y - height * 0.6), (x + lean, y - height), width, width * 0.2, 0.9)


# --- small flowers, drawn on the cell grid -------------------------------------------------------

# Tones that sit well inside the four mosaic levels, so the noise in Canvas.mosaic cannot change a cell's tone.
LIT, MID, SHADE = 0.95, 0.70, 0.47
_LIGHT = (math.cos(LIGHT_ANGLE), math.sin(LIGHT_ANGLE))

_TULIP = ("A.B.C",
          "AABCC",
          "AABBC",
          ".ABB.")
_TONE = {"A": LIT, "B": MID, "C": SHADE}


def daisy(cv: Canvas, gx: int, gy: int, radius: float) -> None:
    """Five round petals round a golden eye, on the cell grid; (gx, gy) is the centre cell."""
    start = cv.rng.uniform(0.0, 2.0 * math.pi)
    centres = [(0.62 * radius * math.cos(start + 2.0 * math.pi * k / 5), 0.62 * radius * math.sin(start + 2.0 * math.pi * k / 5)) for k in range(5)]
    reach = int(math.ceil(radius)) + 1
    for j in range(-reach, reach + 1):
        for i in range(-reach, reach + 1):
            if math.hypot(i, j) <= 0.95:
                cv.fill_cell("gold", gx + i, gy + j, LIT if (i, j) != (1, 1) else MID)
            elif any(math.hypot(i - cx, j - cy) <= 0.42 * radius + 0.3 for cx, cy in centres):
                d = math.hypot(i, j) or 1.0
                lit = (i * _LIGHT[0] + j * _LIGHT[1]) / d
                cv.fill_cell("petal", gx + i, gy + j, LIT if lit > 0.3 else MID if lit > -0.45 else SHADE)


def tulip(cv: Canvas, gx: int, gy: int) -> None:
    """A small red cup; (gx, gy) is its top-left cell."""
    for j, row in enumerate(_TULIP):
        for i, ch in enumerate(row):
            if ch in _TONE:
                cv.fill_cell("petal", gx + i, gy + j, _TONE[ch])


def cell_stem(cv: Canvas, x0: int, y0: int, x1: int, y1: int, leaves: tuple[int, ...]) -> None:
    """A one-cell stem from (x0, y0) down to (x1, y1) in cell units, always joined edge to edge, with leaves."""
    span = max(1, y1 - y0)
    prev = x0
    xs = {}
    for y in range(y0, y1 + 1):
        t = (y - y0) / span
        x = x0 + round((x1 - x0) * t * t * (3.0 - 2.0 * t))
        xs[y] = x
        for fx in range(min(prev, x), max(prev, x) + 1):
            cv.fill_cell("stalk", fx, y, LIT)
        prev = x
    for n, y in enumerate(leaves):
        if y not in xs:
            continue
        side = -1 if n % 2 == 0 else 1
        for dx, dy, tone in ((1, 0, MID), (2, -1, LIT), (3, -1, LIT), (2, 0, MID), (4, -2, SHADE)):
            cv.fill_cell("stalk", xs[y] + side * dx, y + dy, tone)


# Butterfly and bee: hand-set cell patterns. P petal colour, G gold, H dark body, . empty.
_BUTTERFLY = (".PP...PP.",
              "PPPP.PPPP",
              "PGPPHPPGP",
              "PPPPHPPPP",
              ".PPPHPPP.",
              "..PP.PP..")
_BEE = (".GH.",
        "GHGH",
        ".GH.")


def _pattern(cv: Canvas, rows: tuple[str, ...], gx: int, gy: int, colours: dict[str, str]) -> None:
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch in colours:
                lit = 1.0 - 0.5 * (j / len(rows))                      # the lower half of a wing sits in shade
                cv.fill_cell(colours[ch], gx + i, gy + j, LIT if lit > 0.8 else MID if ch != "H" else LIT)


def butterfly(cv: Canvas, gx: int, gy: int, gold_wings: bool = False) -> None:
    _pattern(cv, _BUTTERFLY, gx, gy, {"P": "gold" if gold_wings else "petal", "G": "petal" if gold_wings else "gold", "H": "heart"})


def bee(cv: Canvas, gx: int, gy: int) -> None:
    _pattern(cv, _BEE, gx, gy, {"G": "gold", "H": "heart"})

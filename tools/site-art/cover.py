"""The sample album cover in the site's music widget: one red pixel poppy on paper, drawn by the art engine.

    python -I tools/site-art/cover.py

Writes website/src/assets/photos/cover-poppy.webp (a colour picture, not a mask: it is a cover, so it keeps
its own colours in every theme). Same craft as the hero's flowers (siteart/pixel.py).
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from siteart.pixel import Canvas, grass, poppy, stem_with_leaves  # noqa: E402

OUT = HERE.parents[1] / "website" / "src" / "assets" / "photos" / "cover-poppy.webp"
SIZE, SCALE, CELL, SEED = 120, 2.0, 5.0, 17
PAPER = "#ece7dc"
INK = {"stalk": "#4d7a47", "petal": "#da3038", "heart": "#2b2b27", "gold": "#f0b43c"}


def _rgb(hex_color: str) -> np.ndarray:
    return np.array([int(hex_color[i : i + 2], 16) for i in (1, 3, 5)], dtype=np.float32) / 255.0


def main() -> None:
    cv = Canvas(SIZE, SIZE, SCALE, cell=CELL, rng=np.random.default_rng(SEED))
    stem_with_leaves(cv, (62, 48), (58, 124), -8.0, 3.4, (0.45, 0.7), 22.0)
    for k in range(9):
        grass(cv, 14 + 11 * k, 124, 16 + (k * 7) % 13, (-1) ** k * 5.0, 3.0)
    poppy(cv, 62, 46, 30)
    img = np.broadcast_to(_rgb(PAPER), (cv.h, cv.w, 3)).copy()
    layers = {name: cv.mosaic(name) for name in INK}
    shadow = cv.stipple(np.clip(sum(layers.values()), 0.0, 1.0), 4.0, 5.0, 3.0)
    img += (_rgb(INK["heart"]) - img) * (0.35 * shadow)[..., None]
    for name in ("stalk", "petal", "gold", "heart"):
        img += (_rgb(INK[name]) - img) * layers[name][..., None]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(img * 255 + 0.5, 0, 255).astype(np.uint8), "RGB").save(OUT, "WEBP", lossless=True, method=6)
    print(f"{OUT.name}: {OUT.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()

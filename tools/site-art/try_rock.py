"""Scratch preview driver (not shipped): renders several seeds of a rock into one sheet."""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from siteart.mask import preview  # noqa: E402
from siteart.rocks import render_rock  # noqa: E402

OUT = HERE.parents[1] / ".cache" / "site-art" / "work"
planes = int(sys.argv[1])
seeds = [int(s) for s in sys.argv[2:]]
theme = "paper"
tiles = []
for sd in seeds:
    r = render_rock(520, 640, 1.0, sd, planes)
    key = "dark" if theme == "paper" else "light"
    preview([(r["body"] * 0.10, "ink"), (r[key], "ink")], theme, OUT / "tmp.png")
    tiles.append(Image.open(OUT / "tmp.png").resize((390, 480)))
sheet = Image.new("RGB", (390 * len(tiles), 480))
for i, t in enumerate(tiles):
    sheet.paste(t, (i * 390, 0))
sheet.save(OUT / "rock-sheet.png")

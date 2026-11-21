"""Composites each living scene (siteart/live.py) into one still per theme, the way LiveScene.astro stacks it, so a
scene can be judged before the masks are generated.

    python -I tools/site-art/live_preview.py [--narrow] [--scale 1]

Writes .cache/site-art/preview/live-<scene>-<variant>-<theme>.png.
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from siteart.live import LIVE, VARIANTS  # noqa: E402
import vista_preview  # noqa: E402
from vista_preview import COLOURS, OUT, paint, rgb  # noqa: E402

# The open water and the sea sit behind everything else.
vista_preview.ORDER = ("sea", *vista_preview.ORDER)

SEA = {"paper": "#8fb0c9", "obsidian": "#3d5f78", "aurum": "#8c6d2a"}
STACKS = {
    "paddock": ["land", "tail", "horse", "head", "sway-b", "sway-a"],
    "pond": ["land", "ripples-a", "ripples-b", "glint", "reeds-b", "pads-a", "pads-b", "reeds-a"],
    "reef": ["land", "weed-b", "arms", "head", "weed-a"],
}
SPRITES = {"pond": [("live-dragonfly", 0.40, 0.30), ("live-dragonfly", 0.62, 0.40)],
           "reef": [("live-fish-gold", 0.25, 0.30), ("live-fish-apricot", 0.70, 0.20), ("live-fish-violet", 0.60, 0.55)]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--narrow", action="store_true")
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    variant = "narrow" if args.narrow else "wide"
    w, h = VARIANTS[variant]
    OUT.mkdir(parents=True, exist_ok=True)
    for scene, parts in STACKS.items():
        if args.only and scene != args.only:
            continue
        stack = [LIVE[f"live-{scene}-{p}"][2](variant, w, h, args.scale) for p in parts]
        sprites = [(LIVE[n][2](variant, *LIVE[n][1][variant], args.scale), fx, fy) for n, fx, fy in SPRITES.get(scene, [])]
        for theme in COLOURS:
            colours = COLOURS[theme] | {"sea": SEA[theme]}
            COLOURS[theme] = colours
            img = np.broadcast_to(rgb(colours["bg"]), (int(h * args.scale), int(w * args.scale), 3)).copy()
            for layers in stack:
                paint(img, layers, theme)
            for layers, fx, fy in sprites:
                paint(img, layers, theme, int(fx * w * args.scale), int(fy * h * args.scale))
            path = OUT / f"live-{scene}-{variant}-{theme}.png"
            Image.fromarray(np.clip(img * 255 + 0.5, 0, 255).astype(np.uint8)).save(path)
            print(path)


if __name__ == "__main__":
    main()

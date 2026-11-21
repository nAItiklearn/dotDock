"""Composites the download page's meadow (siteart/vista.py) into one still per theme and width, the way the
page stacks it, so the scene can be judged before the masks are generated.

    python -I tools/site-art/vista_preview.py [--narrow] [--scale 1]

Writes .cache/site-art/preview/vista-<variant>-<theme>.png. The colours are the art tokens of
website/src/lib/themes.ts plus the meadow's own tokens in website/src/styles/download.css.
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

from siteart.vista import VARIANTS, render_clouds, render_flyer, render_glint, render_land, render_sway  # noqa: E402

OUT = HERE.parents[1] / ".cache" / "site-art" / "preview"

# Keep in step with themes.ts (bg and the art tokens) and download.css (pink, violet, apricot, cream, glow).
COLOURS = {
    "paper": {"bg": "#f6f5f2", "far": "#b3c0ae", "mid": "#86a37e", "near": "#4d7a47", "stalk": "#4d7a47", "petal": "#da3038",
              "gold": "#f0b43c", "heart": "#2b2b27", "grain": "#2b2b27", "cloud": "#c3cfdb", "glow": "#f0b43c",
              "pink": "#e0709a", "violet": "#6b63c8", "apricot": "#ee8a3a", "cream": "#fffaf0"},
    "obsidian": {"bg": "#0e0e0e", "far": "#2f3f35", "mid": "#476650", "near": "#6f9a76", "stalk": "#6f9a76", "petal": "#e94248",
                 "gold": "#f2c75c", "heart": "#8a5a35", "grain": "#d8d4cb", "cloud": "#3a4756", "glow": "#f2c75c",
                 "pink": "#ec80a6", "violet": "#958be6", "apricot": "#f29a50", "cream": "#f2ede2"},
    "aurum": {"bg": "#0d0c0a", "far": "#3d3422", "mid": "#6e5828", "near": "#b08a38", "stalk": "#b08a38", "petal": "#f4efe4",
              "gold": "#e3b456", "heart": "#8a6a2c", "grain": "#e8dcc0", "cloud": "#5a4a2a", "glow": "#e3b456",
              "pink": "#d9b98a", "violet": "#9c8a62", "apricot": "#e8cf98", "cream": "#f4efe4"},
}
ORDER = ("glow", "far", "mid", "near", "grain", "stalk", "cream", "violet", "pink", "apricot", "petal", "gold", "heart", "cloud")
GRAIN_OPACITY = 0.4


def rgb(h: str) -> np.ndarray:
    return np.array([int(h[i : i + 2], 16) for i in (1, 3, 5)], dtype=np.float32) / 255.0


def paint(img: np.ndarray, layers: dict[str, np.ndarray], theme: str, x: int = 0, y: int = 0) -> None:
    c = COLOURS[theme]
    for k in ORDER:
        if k not in layers:
            continue
        cov = layers[k] * (GRAIN_OPACITY if k == "grain" else 1.0)
        h, w = cov.shape
        sub = img[y : y + h, x : x + w]
        cov = cov[: sub.shape[0], : sub.shape[1], None]
        sub += (rgb(c[k]) - sub) * cov


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--narrow", action="store_true")
    ap.add_argument("--scale", type=float, default=1.0)
    args = ap.parse_args()
    variant = "narrow" if args.narrow else "wide"
    w, h = VARIANTS[variant]
    s, n = args.scale, args.narrow
    stack = [render_land(w, h, s, n), render_clouds(w, h, s, n), render_glint(w, h, s, n, 0), render_glint(w, h, s, n, 1),
             render_sway(w, h, s, n, 1), render_sway(w, h, s, n, 0)]
    flyers = [("red", 0.22, 0.52), ("gold", 0.47, 0.60), ("violet", 0.80, 0.56)]
    OUT.mkdir(parents=True, exist_ok=True)
    for theme in COLOURS:
        img = np.broadcast_to(rgb(COLOURS[theme]["bg"]), (int(h * s), int(w * s), 3)).copy()
        for layers in stack:
            paint(img, layers, theme)
        for kind, fx, fy in flyers:
            paint(img, render_flyer(kind, n, s), theme, int(fx * w * s), int(fy * h * s))
        path = OUT / f"vista-{variant}-{theme}.png"
        Image.fromarray(np.clip(img * 255 + 0.5, 0, 255).astype(np.uint8)).save(path)
        print(path)


if __name__ == "__main__":
    main()

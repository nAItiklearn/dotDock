"""The registry of pieces: what each one is called, its variants (CSS pixel sizes) and how it renders."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from .vignette import KINDS as VIGNETTES, render_vignette
from .bloom import render_bouquet, render_tuft
from .scape import render_scape
from .scene import render_scene

Layers = dict[str, np.ndarray]


@dataclass(frozen=True)
class Piece:
    seed: int
    variants: dict[str, tuple[int, int]]            # variant -> (css width, css height)
    render: Callable[[str, int, int, float], Layers]
    preview_stack: Callable[[Layers, str], list]
    quality: dict[str, tuple[int, int]] = field(default_factory=dict)   # layer -> (webp quality, alpha quality)


# Preview colours of the layers per theme: the same values as the art tokens in website/src/lib/themes.ts.
_COLOURS = {
    "paper": {"far": "#b3c0ae", "mid": "#86a37e", "near": "#4d7a47", "stalk": "#4d7a47", "petal": "#da3038", "gold": "#f0b43c", "heart": "#2b2b27", "grain": "#2b2b27", "cloud": "#c3cfdb", "sea": "#8fb0c9", "line": "#da3038"},
    "obsidian": {"far": "#2f3f35", "mid": "#476650", "near": "#6f9a76", "stalk": "#6f9a76", "petal": "#e94248", "gold": "#f2c75c", "heart": "#8a5a35", "grain": "#d8d4cb", "cloud": "#3a4756", "sea": "#3d5f78", "line": "#e94248"},
    "aurum": {"far": "#3d3422", "mid": "#6e5828", "near": "#b08a38", "stalk": "#b08a38", "petal": "#f4efe4", "gold": "#e3b456", "heart": "#8a6a2c", "grain": "#e8dcc0", "cloud": "#5a4a2a", "sea": "#8c6d2a", "line": "#e3b456"},
}
_ORDER = ("grain", "cloud", "sea", "far", "mid", "near", "stalk", "line", "petal", "gold", "heart")


def _colour_stack(layers: Layers, theme: str) -> list:
    c = _COLOURS[theme]
    return [(layers[k] * (0.45 if k == "grain" else 1.0), c[k]) for k in _ORDER if k in layers]


def _scape(variant: str, w: int, h: int, scale: float) -> Layers:
    return render_scape(w, h, scale, seed=11 if variant == "wide" else 12, narrow=variant == "narrow")


def _scene(kind: str, seed: int):
    def render(variant: str, w: int, h: int, scale: float) -> Layers:
        return render_scene(w, h, scale, seed, kind, narrow=variant == "narrow")
    return render


def _band(kind: str, seed: int):
    def render(variant: str, w: int, h: int, scale: float) -> Layers:
        return render_vignette(w, h, scale, seed, kind, narrow=variant == "narrow")
    return render


def _bouquet(seed: int, side: str):
    def render(variant: str, w: int, h: int, scale: float) -> Layers:
        return render_bouquet(w, h, scale, seed, side, narrow=variant == "narrow")
    return render


def _tuft(seed: int, side: str):
    def render(variant: str, w: int, h: int, scale: float) -> Layers:
        return render_tuft(w, h, scale, seed, side, narrow=variant == "narrow")
    return render


_SCENE_Q = {"far": (78, 60), "mid": (78, 60), "near": (78, 60)} | {k: (100, 100) for k in ("stalk", "petal", "gold", "heart")} | {"grain": (80, 70)}
_FLAT = {k: (100, 100) for k in ("stalk", "petal", "gold", "heart")} | {"grain": (80, 70)}

PIECES: dict[str, Piece] = {
    "scape": Piece(11, {"wide": (1920, 900), "narrow": (720, 340)}, _scape, _colour_stack,
                   {"far": (78, 60), "mid": (78, 60), "near": (78, 60)}),
    "bouquet-left": Piece(31, {"wide": (480, 640), "narrow": (190, 300)}, _bouquet(31, "left"), _colour_stack, _FLAT),
    "bouquet-right": Piece(32, {"wide": (480, 640), "narrow": (190, 300)}, _bouquet(32, "right"), _colour_stack, _FLAT),
    "tuft-left": Piece(41, {"wide": (280, 190), "narrow": (150, 110)}, _tuft(41, "left"), _colour_stack, _FLAT),
    "tuft-right": Piece(42, {"wide": (280, 190), "narrow": (150, 110)}, _tuft(42, "right"), _colour_stack, _FLAT),
    **{
        f"band-{kind}": Piece(81 + i, {"wide": (1920, 300), "narrow": (720, 240)}, _band(kind, 81 + i), _colour_stack, _SCENE_Q | {"cloud": (100, 100), "sea": (78, 60), "line": (80, 80)})
        for i, kind in enumerate(VIGNETTES)
    },
    "meadow": Piece(71, {"wide": (1920, 420), "narrow": (720, 300)}, _scene("meadow", 71), _colour_stack, _SCENE_Q),
}

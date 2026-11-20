"""The registry of pieces: what each one is called, its variants (CSS pixel sizes) and how it renders."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from .horizon import render_horizon
from .rocks import render_rock
from .scape import render_scape

Layers = dict[str, np.ndarray]


@dataclass(frozen=True)
class Piece:
    seed: int
    variants: dict[str, tuple[int, int]]            # variant -> (css width, css height)
    render: Callable[[str, int, int, float], Layers]
    preview_stack: Callable[[Layers, str], list]
    quality: dict[str, tuple[int, int]] = field(default_factory=dict)   # layer -> (webp quality, alpha quality)


def _ink_accent_stack(layers: Layers, theme: str) -> list:
    return [(layers["ink"], "ink"), (layers["accent"], "accent")]


def _scape(variant: str, w: int, h: int, scale: float) -> Layers:
    return render_scape(w, h, scale, seed=11 if variant == "wide" else 12, narrow=variant == "narrow")


def _horizon(variant: str, w: int, h: int, scale: float) -> Layers:
    return render_horizon(w, h, scale, seed=21 if variant == "wide" else 22, narrow=variant == "narrow")


def _rock(seed: int):
    def render(variant: str, w: int, h: int, scale: float) -> Layers:
        pitch = 5.5 if variant == "wide" else 3.8
        r = render_rock(w, h, scale, seed, planes=11, pitch=pitch)
        return {"body": r["body"], "ink-paper": r["dark"], "ink-dark": r["light"]}

    def stack(layers: Layers, theme: str) -> list:
        return [(layers["body"] * 0.10, "ink"), (layers["ink-paper" if theme == "paper" else "ink-dark"], "ink")]

    return render, stack


_ROCK_Q = {"body": (70, 60), "ink-paper": (80, 70), "ink-dark": (80, 70)}
_rock_l, _rock_l_stack = _rock(8)
_rock_r, _rock_r_stack = _rock(5)

PIECES: dict[str, Piece] = {
    "scape": Piece(11, {"wide": (1920, 760), "narrow": (900, 700)}, _scape, _ink_accent_stack,
                   {"ink": (78, 60), "accent": (80, 70)}),
    "rock-left": Piece(8, {"wide": (460, 560), "narrow": (210, 260)}, _rock_l, _rock_l_stack, _ROCK_Q),
    "rock-right": Piece(5, {"wide": (460, 560), "narrow": (210, 260)}, _rock_r, _rock_r_stack, _ROCK_Q),
    "horizon": Piece(21, {"wide": (1920, 820), "narrow": (900, 700)}, _horizon, _ink_accent_stack,
                     {"ink": (78, 60), "accent": (80, 70)}),
}

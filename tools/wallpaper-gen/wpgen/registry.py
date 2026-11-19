"""Style registry. Each style module exposes ``STYLES``: a list of :class:`Style`."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


@dataclass(frozen=True)
class Style:
    id: str
    name: str            # short, original display name
    style: str           # style family, for the manifest
    seed: int
    accent: dict         # {"dark": "#hex", "light": "#hex"}: dominant accent colour of each variant
    render: Callable     # render(canvas, mode, seed) -> float32 (H, W, 3) sRGB in 0..1
    grain: dict = field(default_factory=lambda: {"dark": 1.5, "light": 1.5})


MODULES = ("louvers", "arcs", "dots", "geometry", "waves", "metal", "soft", "orbs", "topo")


def all_styles() -> list[Style]:
    import importlib

    out: list[Style] = []
    for name in MODULES:
        out.extend(importlib.import_module(f"{__package__}.styles.{name}").STYLES)
    return out

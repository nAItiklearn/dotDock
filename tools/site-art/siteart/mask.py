"""Writing masks (WebP, white with the coverage in the alpha channel) and previewing them in a theme."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

# Theme colours as facts, copied from website/src/lib/themes.ts (bg, text, accent). Only used to preview
# a mask the way the page will paint it; the shipped files carry no colour at all.
THEMES = {
    "paper": ("#e8e6e3", "#111111", "#da3038"),
    "obsidian": ("#111111", "#e8e6e3", "#e94248"),
    "aurum": ("#0c0c0c", "#f5f4f1", "#e2b453"),
}


def _rgb(hex_color: str) -> np.ndarray:
    h = hex_color.lstrip("#")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255.0


def to_alpha8(cov: np.ndarray) -> np.ndarray:
    return np.clip(cov * 255.0 + 0.5, 0, 255).astype(np.uint8)


def save_mask(cov: np.ndarray, path: Path, quality: int = 80, alpha_quality: int = 70) -> int:
    """Lossy WebP of white pixels whose alpha is the coverage. Returns the file size in bytes."""
    a = to_alpha8(cov)
    rgba = np.empty(a.shape + (4,), dtype=np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = a
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(path, "WEBP", quality=quality, alpha_quality=alpha_quality, method=6, exact=True)
    return path.stat().st_size


def preview(layers: list[tuple[np.ndarray, str]], theme: str, out: Path, bg_extra: np.ndarray | None = None) -> None:
    """Composite masks over the theme background. Each layer is (coverage, 'ink' | 'accent' | 'dim')."""
    bg, ink, accent = (_rgb(c) for c in THEMES[theme])
    h, w = layers[0][0].shape
    img = np.broadcast_to(bg, (h, w, 3)).copy()
    for cov, role in layers:
        col = {"ink": ink, "accent": accent, "dim": ink * 0.5 + bg * 0.5}[role]
        img = img + (col - img) * cov[..., None]
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(img * 255 + 0.5, 0, 255).astype(np.uint8), "RGB").save(out)

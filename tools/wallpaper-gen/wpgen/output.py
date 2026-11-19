"""Quantisation (grain + dither), JPEG encoding within a size budget, zone checks, contact sheet."""
from __future__ import annotations

import io
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .core import F32, smoothstep

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=F32)
BUDGET_BYTES = 2_500_000


def to_uint8(img: np.ndarray, seed: int, grain: float = 1.5, grain_sigma_px: float = 0.7, chroma: float = 0.35,
             shadow_floor: float = 0.55) -> np.ndarray:
    """sRGB float image (0..1) -> uint8 with luminance-weighted film grain acting as the dither.

    ``grain`` is the standard deviation of the mono grain in 8-bit levels; ``grain_sigma_px`` is the
    grain size (a small gaussian blur makes it look like film, not digital noise).
    """
    h, w, _ = img.shape
    rng = np.random.default_rng(seed + 7919)
    n = rng.standard_normal((h, w), dtype=F32)
    scale = h / 2160.0
    sig = grain_sigma_px * max(scale, 0.5)
    if sig > 0.3:
        n = cv2.GaussianBlur(n, (0, 0), sig)
        n *= 2.0 * sig * math.sqrt(math.pi)  # restore unit variance after the blur
    lum = img @ LUMA
    weight = shadow_floor + (1.0 - shadow_floor) * smoothstep(0.0, 0.30, lum)
    n *= (grain * weight).astype(F32)
    out = img * 255.0
    out += n[..., None]
    if chroma > 0:
        out += rng.standard_normal((h, w, 3), dtype=F32) * F32(chroma)
    np.clip(out, 0, 255, out=out)
    out += F32(0.5)
    return out.astype(np.uint8)


def encode_jpeg(arr: np.ndarray, quality: int, subsampling: int, comment: bytes) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr, "RGB").save(buf, "JPEG", quality=quality, subsampling=subsampling, optimize=True, comment=comment)
    return buf.getvalue()


def save_jpeg_budget(img: np.ndarray, path: Path, seed: int, grain: float, comment: str, budget: int = BUDGET_BYTES,
                     grain_sigma_px: float = 0.7, chroma: float = 0.35) -> tuple[int, dict]:
    """Encode at quality 92. If the file exceeds the budget, step down chroma subsampling then grain."""
    attempts = [(1.0, 0), (1.0, 1), (1.0, 2), (0.8, 2), (0.65, 2), (0.5, 2), (0.35, 2)]
    info = {}
    data = b""
    arr = None
    for gscale, sub in attempts:
        arr = to_uint8(img, seed, grain * gscale, grain_sigma_px, chroma * gscale)
        data = encode_jpeg(arr, 92, sub, comment.encode("ascii"))
        info = {"grain_scale": gscale, "subsampling": {0: "4:4:4", 1: "4:2:2", 2: "4:2:0"}[sub]}
        if len(data) <= budget:
            break
    path.write_bytes(data)
    return len(data), info


# ---------------------------------------------------------------------------
# Widget-legibility zone check
# ---------------------------------------------------------------------------
def _rel_lum(rgb8: np.ndarray) -> np.ndarray:
    c = rgb8.astype(F32) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return lin @ LUMA


def zone_check(arr: np.ndarray, mode: str) -> dict:
    """Contrast of widget text against the worst 1 % of pixels in the widget zones, and busy-ness.

    dark mode: text #f5f4f1 vs the brightest 1 %; light mode: text #111111 vs the darkest 1 %.
    """
    h, w, _ = arr.shape
    small = cv2.resize(arr, (w // 4, h // 4), interpolation=cv2.INTER_AREA)
    hh, ww, _ = small.shape
    zones = {
        "left40": small[:, : int(ww * 0.40)],
        "topright": small[: int(hh * 0.28), int(ww * 0.74) :],
    }
    text_l = float(_rel_lum(np.array([[[245, 244, 241]]], dtype=np.uint8))[0, 0]) if mode == "dark" else float(
        _rel_lum(np.array([[[17, 17, 17]]], dtype=np.uint8))[0, 0])
    out = {}
    for name, z in zones.items():
        lum = _rel_lum(z)
        edge = np.hypot(cv2.Sobel(lum, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(lum, cv2.CV_32F, 0, 1, ksize=3))
        worst = float(np.percentile(lum, 99 if mode == "dark" else 1))
        ratio = (text_l + 0.05) / (worst + 0.05) if mode == "dark" else (worst + 0.05) / (text_l + 0.05)
        out[name] = {"contrast": round(ratio, 1), "busy": round(float(np.percentile(edge, 95)) * 100, 1)}
    return out


# ---------------------------------------------------------------------------
# Contact sheet + manifest
# ---------------------------------------------------------------------------
def _font(size: int):
    for name in ("consola.ttf", "segoeui.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def contact_sheet(entries: list[dict], out_dir: Path, dest: Path) -> None:
    """1920x1080 sheet: rows alternate dark / light for six wallpapers each."""
    sheet_w, sheet_h = 1920, 1080
    cols = 6
    gap = 8
    label_h = 24
    cw = (sheet_w - gap * (cols + 1)) // cols
    chh = round(cw * 9 / 16)
    bg = (12, 12, 12)
    sheet = Image.new("RGB", (sheet_w, sheet_h), bg)
    d = ImageDraw.Draw(sheet)
    font = _font(15)
    ids = []
    for e in entries:
        if e["id"] not in ids:
            ids.append(e["id"])
    by_key = {(e["id"], e["mode"]): e for e in entries}
    rows = math.ceil(len(ids) / cols) * 2
    title_h = 44
    total_h = rows * (chh + label_h + gap // 2)
    y0 = title_h + max(gap, (sheet_h - title_h - total_h) // 2)
    d.text((gap + 2, 12), f"dotDock wallpapers: {len(ids)} procedural originals, dark and light  |  generated from maths + fixed seeds",
           fill=(232, 230, 227), font=_font(18))
    d.ellipse((sheet_w - 28, 16, sheet_w - 14, 30), fill=(233, 66, 72))
    for i, wid in enumerate(ids):
        block, col = divmod(i, cols)
        for m, mode in enumerate(("dark", "light")):
            e = by_key.get((wid, mode))
            if not e:
                continue
            x = gap + col * (cw + gap)
            y = y0 + (block * 2 + m) * (chh + label_h + gap // 2)
            with Image.open(out_dir / e["file"]) as im:
                im.draft("RGB", (cw * 2, chh * 2))
                th = im.convert("RGB").resize((cw, chh), Image.LANCZOS)
            sheet.paste(th, (x, y))
            d.text((x + 2, y + chh + 3), f"{wid}  {mode}", fill=(200, 198, 195), font=font)
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest, "JPEG", quality=90)


def write_manifest(entries: list[dict], dest: Path) -> None:
    dest.write_text(json.dumps({"generator": "dotDock wallpaper-gen", "version": 1, "wallpapers": entries}, indent=2) + "\n",
                    encoding="utf-8")

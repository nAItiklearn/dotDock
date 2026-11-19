"""Builds every dotDock brand asset from the one master drawing in mark.py.

    python -I tools/brand-gen/build.py

Outputs: the Tauri icons (a multi-size .ico and PNGs), the website favicon, apple-touch icon and
mark component, the SVG logos and the social preview in brand/, and the images brand/README.md
shows. The product name is read from apps/desktop/src/lib/branding.ts, so a rename is one edit
there and a re-run here.

    python -I -m venv .cache/venv && .cache/venv/Scripts/python -m pip install -r tools/brand-gen/requirements.txt
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image  # noqa: E402

import compose  # noqa: E402
import guide  # noqa: E402
from mark import MASTER  # noqa: E402
from svgkit import OBSIDIAN, PAPER  # noqa: E402

ROOT = compose.ROOT
ICONS = ROOT / "apps" / "desktop" / "src-tauri" / "icons"
BRAND = ROOT / "brand"
SITE_PUBLIC = ROOT / "website" / "public"
SITE_COMPONENTS = ROOT / "website" / "src" / "components"

# Sizes Windows asks the .ico for: small icon and taskbar at 100/125/150/200 percent, large icon, jumbo.
ICO_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
FAVICON_ICO_SIZES = (16, 32, 48)
APPLE_TOUCH_SIZE = 180
LOGO_PNG_SIZE = 512


def ico_bytes(sizes: tuple[int, ...]) -> bytes:
    """An .ico with one real drawing per size (Pillow uses the supplied frame instead of resizing)."""
    frames = {px: compose.tile_png(px) for px in sizes}
    largest = max(sizes)
    buf = io.BytesIO()
    frames[largest].save(buf, format="ICO", sizes=[(px, px) for px in sizes],
                         append_images=[frames[px] for px in sizes if px != largest])
    return buf.getvalue()


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def outputs() -> dict[Path, bytes]:
    files: dict[Path, bytes] = {}

    def text(path: Path, content: str) -> None:
        files[path] = content.encode("utf-8")

    # App icons. File names are the ones tauri.conf.json lists.
    files[ICONS / "icon.ico"] = ico_bytes(ICO_SIZES)
    files[ICONS / "32x32.png"] = png_bytes(compose.tile_png(32))
    files[ICONS / "128x128.png"] = png_bytes(compose.tile_png(128))
    files[ICONS / "128x128@2x.png"] = png_bytes(compose.tile_png(256))
    files[ICONS / "icon.png"] = png_bytes(compose.tile_png(LOGO_PNG_SIZE))

    # Website.
    text(SITE_PUBLIC / "favicon.svg", compose.favicon_svg())
    files[SITE_PUBLIC / "favicon.ico"] = ico_bytes(FAVICON_ICO_SIZES)
    files[SITE_PUBLIC / "apple-touch-icon.png"] = png_bytes(compose.tile_png(APPLE_TOUCH_SIZE))
    text(SITE_COMPONENTS / "Mark.astro", compose.astro_mark_component())

    # Logos.
    text(BRAND / "logo-mark.svg", compose.tile_svg(MASTER, OBSIDIAN))
    text(BRAND / "logo-mark-light.svg", compose.tile_svg(MASTER, PAPER))
    text(BRAND / "logo-mark-mono.svg", compose.mono_svg())
    text(BRAND / "wordmark.svg", compose.lockup_svg(OBSIDIAN))
    text(BRAND / "wordmark-light.svg", compose.lockup_svg(PAPER))
    files[BRAND / "logo-mark-512.png"] = png_bytes(compose.tile_png(LOGO_PNG_SIZE))
    files[BRAND / "social-preview.png"] = png_bytes(guide.social_preview())

    # Images for brand/README.md.
    for name, img in guide.readme_images().items():
        files[BRAND / "img" / f"{name}.png"] = png_bytes(img)
    return files


def main() -> None:
    for path, data in sorted(outputs().items()):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        print(f"wrote {path.relative_to(ROOT)} ({len(data)} bytes)")


if __name__ == "__main__":
    main()

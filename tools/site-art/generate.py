"""dotDock website art generator: "Field notes, in dots".

Every piece is computed from maths and a fixed seed, or from a public-domain original named in
``sources.json`` (fetched by ``fetch_sources.py`` into .cache/site-art/originals, never shipped). Nothing
here reads the owner's mood images. Output is a set of WebP *masks* (white, coverage in the alpha channel)
that the page paints with its own theme colours, plus ``manifest.json`` describing every file.

    python -I tools/site-art/generate.py [--out website/src/assets/art] [--only scape,rocks] [--scales 1,2]

Needs numpy, Pillow and opencv (the same packages as tools/wallpaper-gen).
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import argparse
import json
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from siteart.mask import preview, save_mask  # noqa: E402
from siteart.pieces import PIECES  # noqa: E402

REPO = HERE.parents[1]
DEFAULT_OUT = REPO / "website" / "src" / "assets" / "art"
PREVIEW_DIR = REPO / ".cache" / "site-art" / "preview"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--only", default="", help="comma-separated piece names (default: all)")
    ap.add_argument("--scales", default="1,2", help="pixel ratios to render")
    ap.add_argument("--preview", action="store_true", help="also write theme previews to .cache/site-art/preview")
    args = ap.parse_args()

    scales = [int(s) for s in args.scales.split(",")]
    wanted = [n for n in args.only.split(",") if n] or list(PIECES)
    manifest_path = args.out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}

    for name in wanted:
        piece = PIECES[name]
        entry: dict = {"seed": piece.seed, "variants": {}}
        for variant, (w_css, h_css) in piece.variants.items():
            ventry: dict = {"w": w_css, "h": h_css, "layers": {}}
            for scale in scales:
                t0 = time.time()
                layers = piece.render(variant, w_css, h_css, float(scale))
                for layer, cov in layers.items():
                    q = piece.quality.get(layer, (80, 70))
                    file = f"{name}-{variant}-{layer}-{scale}x.webp"
                    size = save_mask(cov, args.out / file, quality=q[0], alpha_quality=q[1])
                    ventry["layers"].setdefault(layer, {})[str(scale)] = {"file": file, "w": cov.shape[1], "h": cov.shape[0], "bytes": size}
                if args.preview and scale == scales[0]:
                    for theme in ("paper", "obsidian", "aurum"):
                        stack = piece.preview_stack(layers, theme)
                        if stack:
                            preview(stack, theme, PREVIEW_DIR / f"{name}-{variant}-{theme}.png")
                total = sum(v[str(scale)]["bytes"] for v in ventry["layers"].values())
                print(f"{name:12s} {variant:7s} {scale}x  {time.time() - t0:5.1f}s  {total / 1024:6.0f} KB")
            entry["variants"][variant] = ventry
        manifest[name] = entry
    args.out.mkdir(parents=True, exist_ok=True)
    manifest_path.write_bytes((json.dumps(dict(sorted(manifest.items())), indent=1) + "\n").encode())

    # Drop masks that no manifest entry points at any more (a renamed layer, a removed variant).
    used = {s["file"] for p in manifest.values() for v in p["variants"].values() for l in v["layers"].values() for s in l.values()}
    for stale in sorted(set(f.name for f in args.out.glob("*.webp")) - used):
        (args.out / stale).unlink()
        print(f"removed stale {stale}")


if __name__ == "__main__":
    main()

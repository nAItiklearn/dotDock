"""dotDock procedural wallpaper generator.

Every image is computed from maths and a fixed seed. No reference artwork is read,
traced, resampled or sampled. Needs only numpy, Pillow and opencv.

    python -I tools/wallpaper-gen/generate.py --out assets/wallpapers [--size 3840x2160] [--only id[,id]]
"""
from __future__ import annotations

import os
import sys

sys.dont_write_bytecode = True  # keep the repo free of __pycache__

# Keep BLAS / OpenCV from oversubscribing when several wallpapers render in parallel.
os.environ.setdefault("OPENBLAS_NUM_THREADS", "4")
os.environ.setdefault("OMP_NUM_THREADS", "4")

import argparse
import concurrent.futures as cf
import json
import time
from pathlib import Path

# `python -I` does not put the script directory on sys.path, so add it explicitly.
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from wpgen import output  # noqa: E402
from wpgen.core import Canvas  # noqa: E402
from wpgen.registry import all_styles  # noqa: E402

MODES = ("dark", "light")
REPO = HERE.parents[1]
DEFAULT_CONTACT = REPO / ".cache" / "wallpapers-contact.jpg"


def lower_priority() -> None:
    """Run below normal priority so a long render never makes the desktop sluggish."""
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x00004000)


def parse_size(text: str) -> tuple[int, int]:
    try:
        w, h = text.lower().split("x")
        return int(w), int(h)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("size must look like 3840x2160") from exc


def render_one(task: tuple[str, str, int, int, str]) -> dict:
    """Worker: render one wallpaper variant, encode it, return its manifest entry and timings."""
    import cv2

    lower_priority()
    cv2.setNumThreads(2)
    style_id, mode, w, h, out_dir = task
    style = next(s for s in all_styles() if s.id == style_id)
    t0 = time.perf_counter()
    canvas = Canvas(w, h)
    img = style.render(canvas, mode, style.seed)
    t1 = time.perf_counter()
    path = Path(out_dir) / f"{style.id}-{mode}.jpg"
    comment = f"dotDock procedural wallpaper {style.id} {mode} seed={style.seed}"
    nbytes, info = output.save_jpeg_budget(img, path, style.seed + (0 if mode == "dark" else 101),
                                           style.grain[mode], comment)
    t2 = time.perf_counter()
    from PIL import Image
    import numpy as np

    with Image.open(path) as im:
        zones = output.zone_check(np.asarray(im.convert("RGB")), mode)
    return {
        "id": style.id,
        "name": style.name,
        "style": style.style,
        "mode": mode,
        "file": path.name,
        "seed": style.seed,
        "accent": style.accent[mode],
        "width": w,
        "height": h,
        "bytes": nbytes,
        "_render_s": round(t1 - t0, 1),
        "_encode_s": round(t2 - t1, 1),
        "_enc": info,
        "_zones": zones,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", help="output directory (created if missing)")
    ap.add_argument("--size", type=parse_size, default=(3840, 2160), help="WxH, default 3840x2160")
    ap.add_argument("--only", default="", help="comma-separated wallpaper ids to render")
    ap.add_argument("--mode", choices=MODES, help="render only one variant")
    ap.add_argument("--jobs", type=int, default=3, help="parallel workers (each needs ~1.5 GB at 4K)")
    ap.add_argument("--contact", default=str(DEFAULT_CONTACT), help="contact sheet path ('' to skip)")
    ap.add_argument("--list", action="store_true", help="list wallpaper ids and exit")
    args = ap.parse_args(argv)
    lower_priority()

    styles = all_styles()
    if args.list:
        for s in styles:
            print(f"{s.id:16s} {s.name:20s} {s.style}")
        return 0

    if not args.out:
        ap.error("--out is required")
    wanted = [t for t in args.only.split(",") if t]
    unknown = sorted(set(wanted) - {s.id for s in styles})
    if unknown:
        print(f"unknown id(s): {', '.join(unknown)}", file=sys.stderr)
        return 2

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    w, h = args.size
    tasks = [(s.id, m, w, h, str(out_dir)) for s in styles if not wanted or s.id in wanted
             for m in MODES if not args.mode or m == args.mode]

    t0 = time.perf_counter()
    results: dict[tuple[str, str], dict] = {}
    if args.jobs <= 1 or len(tasks) == 1:
        for t in tasks:
            r = render_one(t)
            results[(r["id"], r["mode"])] = r
            print(f"  {r['id']:14s} {r['mode']:5s} {r['bytes']/1e6:5.2f} MB  render {r['_render_s']}s", flush=True)
    else:
        with cf.ProcessPoolExecutor(max_workers=args.jobs, max_tasks_per_child=1) as pool:
            for r in pool.map(render_one, tasks):
                results[(r["id"], r["mode"])] = r
                print(f"  {r['id']:14s} {r['mode']:5s} {r['bytes']/1e6:5.2f} MB  render {r['_render_s']}s  "
                      f"{r['_enc']['subsampling']} g{r['_enc']['grain_scale']}", flush=True)
    elapsed = time.perf_counter() - t0

    # Manifest: registry order, every variant that exists on disk (so --only merges cleanly).
    prev = {}
    mpath = out_dir / "manifest.json"
    if mpath.exists():
        for e in json.loads(mpath.read_text(encoding="utf-8")).get("wallpapers", []):
            prev[(e["id"], e["mode"])] = e
    entries = []
    for s in styles:
        for m in MODES:
            key = (s.id, m)
            if key in results:
                e = {k: v for k, v in results[key].items() if not k.startswith("_")}
            elif key in prev and (out_dir / prev[key]["file"]).exists():
                e = prev[key]
            else:
                continue
            entries.append(e)
    output.write_manifest(entries, mpath)

    if args.contact:
        output.contact_sheet(entries, out_dir, Path(args.contact))

    total = sum((out_dir / e["file"]).stat().st_size for e in entries)
    print(f"{len(tasks)} image(s) in {elapsed:.1f}s; {len(entries)} in manifest, {total/1e6:.1f} MB total")
    for r in results.values():
        z = r["_zones"]
        print(f"    {r['id']:14s} {r['mode']:5s} left40 contrast {z['left40']['contrast']:>5} busy {z['left40']['busy']:>5} | "
              f"topright contrast {z['topright']['contrast']:>5} busy {z['topright']['busy']:>5}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

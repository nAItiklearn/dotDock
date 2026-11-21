"""Writes website/src/data/live-scenes.json: the geometry LiveScene.astro needs from siteart/live.py (stage sizes,
cell size, the pivots the moving parts turn about, the dragonfly's wing root), so the page never hard-codes it.

    python -I tools/site-art/live_export.py
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from siteart.live import export  # noqa: E402

OUT = HERE.parents[1] / "website" / "src" / "data" / "live-scenes.json"


def main() -> None:
    def rounded(v):
        if isinstance(v, float):
            return round(v, 5)
        if isinstance(v, dict):
            return {k: rounded(x) for k, x in v.items()}
        if isinstance(v, list):
            return [rounded(x) for x in v]
        return v
    OUT.write_text(json.dumps(rounded(export()), indent=1) + "\n", encoding="utf-8")
    print(OUT)


if __name__ == "__main__":
    main()

"""Scratch preview driver (not shipped): renders one piece and previews it in the three themes."""
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from siteart.mask import preview, save_mask  # noqa: E402
from siteart.scape import render_scape  # noqa: E402

OUT = HERE.parents[1] / ".cache" / "site-art" / "work"
t = time.time()
r = render_scape(1920, 820, 1.0, 11)
print("render", round(time.time() - t, 1), "s")
for th in ("paper", "obsidian", "aurum"):
    preview([(r["ink"], "ink"), (r["accent"], "accent")], th, OUT / f"scape-{th}.png")
print("ink bytes", save_mask(r["ink"], OUT / "scape-ink.webp"), "accent", save_mask(r["accent"], OUT / "scape-accent.webp"))

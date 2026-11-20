"""Subset the Inter files the website uses into small Latin WOFF2 files.

Inter 4.1 (rsms/inter, SIL OFL 1.1) is downloaded by hand from
https://github.com/rsms/inter/releases/tag/v4.1 into an empty folder; this script reads four of its
static web files from there and writes the subsets to website/src/assets/fonts. Inter Display is the
optical size drawn for headlines (the font cooldock.app sets its headlines in; the files are Inter's,
not theirs). Needs fontTools and brotli (build-time only, MIT and MIT).

    python -I tools/site-art/subset_fonts.py <folder with the Inter .woff2 files> [<out folder>]
"""
from __future__ import annotations

import sys
from pathlib import Path

from fontTools import subset

FILES = {
    "InterDisplay-ExtraBold.woff2": "InterDisplay-800.woff2",
    "InterDisplay-Bold.woff2": "InterDisplay-700.woff2",
    "Inter-Regular.woff2": "Inter-400.woff2",
    "Inter-Medium.woff2": "Inter-500.woff2",
}
# Basic Latin and Latin-1, general punctuation the copy uses, arrows and the minus and times signs.
UNICODES = "U+0020-007E,U+00A0-00FF,U+2010-2015,U+2018-201E,U+2022,U+2026,U+2190-2193,U+2212,U+00D7"
FEATURES = ["kern", "liga", "calt", "ccmp", "locl", "mark", "mkmk", "tnum", "case"]


def main() -> None:
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[2] / "website" / "src" / "assets" / "fonts"
    for name, target in FILES.items():
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = FEATURES
        opts.notdef_outline = True
        opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
        opts.hinting = False
        font = subset.load_font(str(src / name), opts)
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=subset.parse_unicodes(UNICODES))
        sub.subset(font)
        subset.save_font(font, str(out / target), opts)
        print(f"{target:24s} {(out / target).stat().st_size / 1024:6.1f} KB")


if __name__ == "__main__":
    main()

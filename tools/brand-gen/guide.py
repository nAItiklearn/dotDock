"""The larger compositions: the social preview and the images brand/README.md shows."""
from __future__ import annotations

import base64
import io

from PIL import Image

import compose
from mark import MASTER, UNIT
from svgkit import AURUM, OBSIDIAN, ON_GOLD, PAPER, Palette, raster_size
from typeset import doto_dots, shaped_path

SOCIAL_W, SOCIAL_H = 1280, 640
SOCIAL_MARGIN = 96
SOCIAL_MARK_H = 340.0
SOCIAL_WORD_X = 560.0
LATTICE_PITCH = 40
LATTICE_DOT_R = 2.0
LATTICE_OPACITY = 0.1
TAGLINE = "A free, open-source desktop environment for Windows, drawn in dots."
FACTS = "FREE  /  OPEN SOURCE  /  WINDOWS"

DIM = "#8a8a86"  # textDim on Obsidian
DIM_PAPER = "#6b6a66"  # textDim on Paper
MONO = "GeistMono.woff2"
SANS = "Geist.woff2"
LABEL_SIZE = 14.0
CARD_GAP = 24.0


def _num(v: float) -> str:
    text = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def document(w: float, h: float, body: str) -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_num(w)} {_num(h)}">{body}</svg>'


def label(text: str, x: float, y: float, fill: str = DIM, size: float = LABEL_SIZE, anchor: str = "start",
          weight: float = 500, tracking: float = 0.14) -> str:
    d, w = shaped_path(MONO, text, size, weight, tracking)
    dx = {"start": 0.0, "middle": -w / 2, "end": -w}[anchor]
    return f'<path transform="translate({_num(x + dx)} {_num(y)})" d="{d}" fill="{fill}"/>'


def lattice(w: float, h: float, fill: str, pitch: float = LATTICE_PITCH, r: float = LATTICE_DOT_R,
            opacity: float = LATTICE_OPACITY, skip: tuple[float, float, float, float] | None = None) -> str:
    """A field of faint dots on the lattice. `skip` is a box (x0, y0, x1, y1) left empty."""
    dots = []
    for iy in range(int(h // pitch)):
        for ix in range(int(w // pitch)):
            cx, cy = pitch / 2 + ix * pitch, pitch / 2 + iy * pitch
            if skip and skip[0] <= cx <= skip[2] and skip[1] <= cy <= skip[3]:
                continue
            dots.append(f'<circle cx="{_num(cx)}" cy="{_num(cy)}" r="{_num(r)}"/>')
    return f'<g fill="{fill}" fill-opacity="{opacity}">{"".join(dots)}</g>'


def glyph_at(x: float, y: float, height: float, pal: Palette) -> tuple[str, float]:
    """The free glyph with its top-left at (x, y) and the given height. Returns markup and width."""
    k = height / MASTER.stem_h
    left, top, right, _ = MASTER.extent
    markup = (f'<g transform="translate({_num(x - left * k)} {_num(y - top * k)}) scale({_num(k)})">'
              f"{compose.glyph(MASTER, pal.accent, pal.ink)}</g>")
    return markup, (right - left) * k


def wrap(text: str, size: float, weight: float, max_w: float) -> list[str]:
    lines: list[str] = []
    line = ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if line and shaped_path(SANS, trial, size, weight)[1] > max_w:
            lines.append(line)
            line = word
        else:
            line = trial
    lines.append(line)
    return lines


def social_svg(pal: Palette = OBSIDIAN) -> str:
    text = doto_dots(compose.product_name())
    word_w = SOCIAL_W - SOCIAL_MARGIN - SOCIAL_WORD_X
    s = word_w / text.width
    word_h = text.height * s
    tag_size, tag_lead = 30.0, 42.0
    facts_size = 15.0
    tag_gap, facts_gap = 40.0, 44.0
    tag_lines = wrap(TAGLINE, tag_size, 400, word_w)
    block_h = word_h + tag_gap + tag_size + tag_lead * (len(tag_lines) - 1) + facts_gap + facts_size * 0.7
    block_top = (SOCIAL_H - block_h) / 2

    mark_y = (SOCIAL_H - SOCIAL_MARK_H) / 2
    mark, mark_w = glyph_at(SOCIAL_MARGIN, mark_y, SOCIAL_MARK_H, pal)

    dots = "".join(
        f'<circle cx="{_num(SOCIAL_WORD_X + d.cx * s)}" cy="{_num(block_top + d.cy * s)}" r="{_num(d.r * s)}"/>' for d in text.dots
    )
    y = block_top + word_h + tag_gap + tag_size
    tag = ""
    for line in tag_lines:
        d, _ = shaped_path(SANS, line, tag_size, 400)
        tag += f'<path transform="translate({_num(SOCIAL_WORD_X)} {_num(y)})" d="{d}"/>'
        y += tag_lead
    facts = label(FACTS, SOCIAL_WORD_X, y - tag_lead + facts_gap, DIM, facts_size)
    keep_clear = (SOCIAL_MARGIN - 40, mark_y - 40, SOCIAL_MARGIN + mark_w + 40, mark_y + SOCIAL_MARK_H + 40)
    return document(
        SOCIAL_W, SOCIAL_H,
        f'<rect width="{SOCIAL_W}" height="{SOCIAL_H}" fill="{pal.page}"/>'
        f"{lattice(SOCIAL_W, SOCIAL_H, pal.ink, skip=keep_clear)}"
        f"{mark}"
        f'<g fill="{pal.ink}">{dots}</g>'
        f'<g fill="{DIM}">{tag}</g>{facts}',
    )


def social_preview() -> Image.Image:
    return raster_size(social_svg(), SOCIAL_W, SOCIAL_H)


# ---------------------------------------------------------------- README images

CARD_W = 1600
HERO_W = 1060.0  # width of the lockup on the hero card
ENLARGED_W = 128  # width an enlarged 16 or 32 px icon is shown at
ENLARGED_X = 1000.0
ENLARGED_GAP = 60.0
CROWD_W = 380.0  # width of the "crowded" lockup in the don'ts
CROWD_GAP = 30.0  # font units between mark and name in that example, against 300 in the real lockup


def card(h: float, body: str, pal: Palette = OBSIDIAN, with_lattice: bool = True) -> str:
    back = f'<rect width="{CARD_W}" height="{_num(h)}" fill="{pal.page}"/>'
    return document(CARD_W, h, back + (lattice(CARD_W, h, pal.ink) if with_lattice else "") + body)


def hero() -> str:
    pal = OBSIDIAN
    h = 440.0
    inner, w, lockup_h = compose.lockup(pal)
    s = HERO_W / w
    return card(h, f'<g transform="translate({_num((CARD_W - w * s) / 2)} {_num((h - lockup_h * s) / 2)}) scale({_num(s)})">{inner}</g>')


def construction() -> str:
    pal = OBSIDIAN
    h = 640.0
    d_text = doto_dots("d")
    art_h = 330.0
    s = art_h / d_text.height
    top = 100.0
    centres = (CARD_W / 6, CARD_W / 2, 5 * CARD_W / 6)
    dim_line = f'stroke="{pal.ink}" stroke-opacity="0.45" stroke-width="2" stroke-dasharray="7 7" fill="none"'

    def dots(cx: float, colour_of) -> str:
        x0 = cx - d_text.width * s / 2
        return "".join(
            f'<circle cx="{_num(x0 + d.cx * s)}" cy="{_num(top + d.cy * s)}" r="{_num(d.r * s)}" fill="{colour_of(d)}"/>'
            for d in d_text.dots
        )

    stem_x = max(d.cx for d in d_text.dots)
    bowl = [d for d in d_text.dots if d.cx < stem_x - 1]
    pad = bowl[0].r
    b_left = min(d.cx - d.r for d in bowl)
    b_right = max(d.cx + d.r for d in bowl)
    b_top = min(d.cy - d.r for d in bowl)
    b_bottom = max(d.cy + d.r for d in bowl)
    b_cx, b_cy, b_r = (b_left + b_right) / 2, (b_top + b_bottom) / 2, (b_right - b_left) / 2
    x0b = centres[1] - d_text.width * s / 2
    ring = f'<circle cx="{_num(x0b + b_cx * s)}" cy="{_num(top + b_cy * s)}" r="{_num((b_r + pad * 0.4) * s)}" {dim_line}/>'
    stem_w = 2 * (pad + pad * 0.4)
    pill = (f'<rect x="{_num(x0b + (stem_x - stem_w / 2) * s)}" y="{_num(top - pad * 0.4 * s)}" width="{_num(stem_w * s)}" '
            f'height="{_num((d_text.height + 0.8 * pad) * s)}" rx="{_num(stem_w * s / 2)}" {dim_line}/>')

    # Panel 3: the mark on the 4 unit lattice, one cell per lattice unit.
    left, mtop, right, bottom = MASTER.extent
    k = art_h / MASTER.stem_h
    mx = centres[2] - (right - left) * k / 2
    cell = UNIT * k
    grid = ""
    for i in range(int((right - left) // UNIT) + 1):
        gx = mx + i * cell
        grid += f'<line x1="{_num(gx)}" y1="{_num(top)}" x2="{_num(gx)}" y2="{_num(top + art_h)}"/>'
    for j in range(int((bottom - mtop) // UNIT) + 1):
        gy = top + j * cell
        grid += f'<line x1="{_num(mx)}" y1="{_num(gy)}" x2="{_num(mx + (right - left) * k)}" y2="{_num(gy)}"/>'
    mark, _ = glyph_at(mx, top, art_h, pal)

    captions = ("1   THE D OF THE WORDMARK", "2   ITS DOTS FUSE: ONE DOT, ONE PILL", f"3   DOCKED ON A {UNIT} UNIT LATTICE")
    labels = "".join(label(c, x, 560, DIM, 15, "middle") for c, x in zip(captions, centres))
    body = (
        dots(centres[0], lambda d: pal.ink)
        + dots(centres[1], lambda d: pal.accent if d in bowl else pal.ink)
        + ring + pill
        + f'<g stroke="{pal.ink}" stroke-opacity="0.12" stroke-width="1">{grid}</g>'
        + mark + labels
    )
    return card(h, body, with_lattice=False)


def _dimension(x1: float, y1: float, x2: float, y2: float, ink: str, caption: str) -> str:
    """A measuring line with end ticks and a small caption."""
    horizontal = y1 == y2
    tick = 9.0
    line = f'<line x1="{_num(x1)}" y1="{_num(y1)}" x2="{_num(x2)}" y2="{_num(y2)}"/>'
    if horizontal:
        line += f'<line x1="{_num(x1)}" y1="{_num(y1 - tick)}" x2="{_num(x1)}" y2="{_num(y1 + tick)}"/>'
        line += f'<line x1="{_num(x2)}" y1="{_num(y2 - tick)}" x2="{_num(x2)}" y2="{_num(y2 + tick)}"/>'
        text = label(caption, (x1 + x2) / 2, y1 - 14, ink, 14, "middle")
    else:
        line += f'<line x1="{_num(x1 - tick)}" y1="{_num(y1)}" x2="{_num(x1 + tick)}" y2="{_num(y1)}"/>'
        line += f'<line x1="{_num(x2 - tick)}" y1="{_num(y2)}" x2="{_num(x2 + tick)}" y2="{_num(y2)}"/>'
        text = label(caption, x1 + 18, (y1 + y2) / 2 + 5, ink, 14)
    return f'<g stroke="{ink}" stroke-width="2" stroke-opacity="0.8">{line}</g>{text}'


def clear_space() -> str:
    pal = OBSIDIAN
    h = 560.0
    dash = f'stroke="{pal.ink}" stroke-opacity="0.5" stroke-width="2" stroke-dasharray="8 8" fill="none"'
    left, top, right, bottom = MASTER.extent
    centre_y = 262.0

    # The mark alone: clear space is one dot radius on every side.
    mark_h = 220.0
    k = mark_h / MASTER.stem_h
    unit_r = MASTER.bowl_r * k
    mw = (right - left) * k
    mx, my = 120 + unit_r, centre_y - mark_h / 2
    mark, _ = glyph_at(mx, my, mark_h, pal)
    box = (f'<rect x="{_num(mx - unit_r)}" y="{_num(my - unit_r)}" width="{_num(mw + 2 * unit_r)}" height="{_num(mark_h + 2 * unit_r)}" '
           f'rx="{_num(unit_r * 0.3)}" {dash}/>')
    dims = (_dimension(mx - unit_r, my + mark_h * 0.62, mx, my + mark_h * 0.62, pal.ink, "R")
            + _dimension(mx + mw * 0.75, my - unit_r, mx + mw * 0.75, my, pal.ink, "R"))

    # The lockup: the same clear space, measured from the lockup's own dot.
    inner, lw, lh = compose.lockup(pal)
    ls = 640.0 / lw
    lunit = MASTER.bowl_r * (lh / MASTER.stem_h) * ls
    lx, ly = 760 + lunit, centre_y - lh * ls / 2
    lock = f'<g transform="translate({_num(lx)} {_num(ly)}) scale({_num(ls)})">{inner}</g>'
    lbox = (f'<rect x="{_num(lx - lunit)}" y="{_num(ly - lunit)}" width="{_num(lw * ls + 2 * lunit)}" height="{_num(lh * ls + 2 * lunit)}" '
            f'rx="{_num(lunit * 0.3)}" {dash}/>')
    labels = (label("CLEAR SPACE R = THE DOT'S RADIUS, ON EVERY SIDE", 120, 500, DIM, 15)
              + label("MIN SIZE: MARK 16 PX, WORDMARK 200 PX WIDE", 760, 500, DIM, 15))
    return card(h, box + dims + mark + lbox + lock + labels)


def _data_uri(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def sizes() -> str:
    h = 520.0
    shown = (16, 20, 24, 32, 40, 48, 64)
    parts = [f'<rect width="{CARD_W}" height="{h}" fill="#202020"/>', f'<rect y="{h / 2}" width="{CARD_W}" height="{h / 2}" fill="#f3f3f3"/>']
    x = 90.0
    for px in shown:
        for row, caption in ((0, DIM), (1, DIM_PAPER)):
            y = 70.0 + row * h / 2
            parts.append(f'<image x="{_num(x)}" y="{_num(y)}" width="{px}" height="{px}" href="{_data_uri(compose.tile_png(px))}"/>')
        parts.append(label(f"{px}", x + px / 2, 188, DIM, 14, "middle"))
        parts.append(label(f"{px}", x + px / 2, 188 + h / 2, DIM_PAPER, 14, "middle"))
        x += px + 52
    # 16 and 32 px enlarged to a common width so the pixels can be read.
    for i, px in enumerate((16, 32)):
        bx = ENLARGED_X + i * (ENLARGED_W + ENLARGED_GAP)
        for row, text_fill in ((0, DIM), (1, DIM_PAPER)):
            big = compose.tile_png(px, OBSIDIAN).resize((ENLARGED_W, ENLARGED_W), Image.NEAREST)
            y = 40 + row * h / 2
            parts.append(f'<image x="{_num(bx)}" y="{_num(y)}" width="{ENLARGED_W}" height="{ENLARGED_W}" href="{_data_uri(big)}"/>')
            parts.append(label(f"{px} PX, ENLARGED", bx + ENLARGED_W / 2, y + ENLARGED_W + 36, text_fill, 13, "middle"))
    return document(CARD_W, h, "".join(parts))


def colours() -> str:
    h = 400.0
    swatches = (
        ("CHARCOAL", "#111111", OBSIDIAN.tile, "TILE"),
        ("IVORY", "#e8e6e3", OBSIDIAN.ink, "PILL"),
        ("SIGNAL RED", "#e94248", OBSIDIAN.accent, "DOT"),
        ("PAPER RED", "#e2363d", PAPER.accent, "DOT ON PAPER"),
        ("AURUM GOLD", "#e2b453", AURUM.accent, "DOT IN AURUM"),
    )
    w, gap = 270.0, 31.0
    x = (CARD_W - (len(swatches) * w + (len(swatches) - 1) * gap)) / 2
    body = ""
    for name, hex_, colour, role in swatches:
        stroke = ' stroke="#ffffff" stroke-opacity="0.14" stroke-width="2"' if colour == OBSIDIAN.tile else ""
        body += f'<rect x="{_num(x)}" y="60" width="{w}" height="190" rx="28" fill="{colour}"{stroke}/>'
        body += label(name, x, 292, "#e8e6e3", 14)
        body += label(hex_.upper(), x, 318, DIM, 14)
        body += label(role, x, 344, DIM, 12)
        x += w + gap
    return card(h, body, with_lattice=False)


def themes() -> str:
    h = 460.0
    tile = 300.0
    k = tile / MASTER.box
    gap = 40.0
    pals = ((OBSIDIAN, "OBSIDIAN"), (PAPER, "PAPER"), (AURUM, "AURUM"), (ON_GOLD, "ONE COLOUR ON GOLD"))
    x = (CARD_W - (len(pals) * tile + (len(pals) - 1) * gap)) / 2
    body = ""
    for pal, name in pals:
        body += f'<g transform="translate({_num(x)} 50) scale({_num(k)})">{compose.tile(MASTER, pal, hairline=pal is OBSIDIAN)}</g>'
        body += label(name, x, 400, DIM, 14)
        x += tile + gap
    return card(h, body)


def donts() -> str:
    pal = OBSIDIAN
    h = 760.0
    cell_w, cell_h, gx, gy = 460.0, 280.0, 40.0, 40.0
    x0 = (CARD_W - (3 * cell_w + 2 * gx)) / 2
    mark_h = 150.0
    k = mark_h / MASTER.stem_h
    left, top, right, _ = MASTER.extent
    mw = (right - left) * k

    def placed(extra: str, content: str, cx: float, cy: float) -> str:
        return (f'<g transform="translate({_num(cx - mw / 2)} {_num(cy - mark_h / 2)}) {extra}">'
                f'<g transform="translate({_num(-left * k)} {_num(-top * k)}) scale({_num(k)})">{content}</g></g>')

    plain = compose.glyph(MASTER, pal.accent, pal.ink)
    bowl_only = compose.bowl_svg(MASTER, "#3b82f6") + compose.stem_svg(MASTER, pal.ink)
    outline = (compose.bowl_svg(MASTER, "none", f' stroke="{pal.ink}" stroke-width="1.2"')
               + compose.stem_svg(MASTER, "none", f' stroke="{pal.ink}" stroke-width="1.2"'))
    effects = (
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7a24b"/><stop offset="1" stop-color="#e94248"/></linearGradient>'
        '<filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="2" dy="4" stdDeviation="3" flood-color="#000" flood-opacity="0.9"/></filter></defs>'
        f'<g filter="url(#s)">{compose.bowl_svg(MASTER, "url(#g)")}{compose.stem_svg(MASTER, "url(#g)")}</g>'
    )
    cases = [
        ("DON'T STRETCH", lambda cx, cy: placed(f"translate({_num(mw / 2)} 0) scale(1.45 1) translate({_num(-mw / 2)} 0)", plain, cx, cy)),
        ("DON'T RECOLOUR", lambda cx, cy: placed("", bowl_only, cx, cy)),
        ("DON'T ROTATE", lambda cx, cy: placed(f"rotate(-18 {_num(mw / 2)} {_num(mark_h / 2)})", plain, cx, cy)),
        ("DON'T ADD EFFECTS", lambda cx, cy: placed("", effects, cx, cy)),
        ("DON'T OUTLINE IT", lambda cx, cy: placed("", outline, cx, cy)),
        ("DON'T CROWD IT", None),
    ]
    body = ""
    for i, (caption, draw) in enumerate(cases):
        col, row = i % 3, i // 3
        x, y = x0 + col * (cell_w + gx), 40 + row * (cell_h + gy + 50)
        body += f'<rect x="{_num(x)}" y="{_num(y)}" width="{cell_w}" height="{cell_h}" rx="28" fill="#181818"/>'
        cx, cy = x + cell_w / 2, y + cell_h / 2
        if draw is None:
            crowded, lw, lh = _crowd(pal)
            ls = CROWD_W / lw
            body += f'<g transform="translate({_num(cx - CROWD_W / 2)} {_num(cy - lh * ls / 2)}) scale({_num(ls)})">{crowded}</g>'
        else:
            body += draw(cx, cy)
        body += label(caption, x + cell_w / 2, y + cell_h + 36, DIM, 14, "middle")
    return card(h, body, with_lattice=False)


def _crowd(pal: Palette) -> tuple[str, float, float]:
    """The lockup with the name pushed against the mark, the way it must not be drawn."""
    text = doto_dots(compose.product_name())
    k = text.height / MASTER.stem_h
    left, top, right, _ = MASTER.extent
    x0 = (right - left) * k + CROWD_GAP
    dots = "".join(f'<circle cx="{_num(x0 + d.cx)}" cy="{_num(d.cy)}" r="{_num(d.r)}"/>' for d in text.dots)
    mark = (f'<g transform="translate({_num(-left * k)} {_num(-top * k)}) scale({_num(k)})">'
            f"{compose.glyph(MASTER, pal.accent, pal.ink)}</g>")
    return f'{mark}<g fill="{pal.ink}">{dots}</g>', x0 + text.width, text.height


def readme_images() -> dict[str, Image.Image]:
    sheets = {
        "hero": (hero(), 440),
        "construction": (construction(), 640),
        "clear-space": (clear_space(), 560),
        "sizes": (sizes(), 520),
        "colours": (colours(), 400),
        "themes": (themes(), 460),
        "donts": (donts(), 760),
    }
    return {name: raster_size(svg, CARD_W, h) for name, (svg, h) in sheets.items()}

"""Draws the original dotDock app icon: a 3x3 dot matrix on charcoal, one red dot."""
import sys
from PIL import Image, ImageDraw

SIZE = 1024
SCALE = 4  # supersample for smooth edges
CHARCOAL = (17, 17, 17, 255)
DOT = (232, 230, 227, 255)
DIM = (232, 230, 227, 60)
RED = (233, 66, 72, 255)

def main(out: str) -> None:
    s = SIZE * SCALE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(s * 0.23)
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=radius, fill=CHARCOAL)
    pitch = s * 0.22
    r = s * 0.075
    origin = s / 2 - pitch
    lit = {(0, 0), (1, 0), (2, 0), (0, 1), (0, 2), (1, 2), (2, 2), (2, 1)}
    for row in range(3):
        for col in range(3):
            cx, cy = origin + col * pitch, origin + row * pitch
            color = RED if (col, row) == (1, 1) else (DOT if (col, row) in lit else DIM)
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color)
    img.resize((SIZE, SIZE), Image.LANCZOS).save(out)

if __name__ == "__main__":
    main(sys.argv[1])

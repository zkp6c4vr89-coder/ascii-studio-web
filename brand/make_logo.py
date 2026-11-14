"""Draws the ASCII Studio logo: a lit orb made of characters with a ringed orbit,
inside an Apple-style squircle. Run with Pillow installed:

  python3 brand/make_logo.py

Writes brand/logo-1024.png plus every icon size the web app and extension use.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
N = 1024
SS = 2                      # supersampling for smooth edges
FONT = "/System/Library/Fonts/Menlo.ttc"
RAMP = " .,:-=+*o#%@"

# colour stops from shadow to highlight: indigo -> violet -> magenta -> coral -> amber -> cream
STOPS = [(0.0, (52, 40, 160)), (0.25, (112, 56, 220)), (0.45, (214, 60, 170)),
         (0.65, (255, 98, 92)), (0.85, (255, 178, 70)), (1.0, (255, 240, 210))]


def gradient(t: float) -> tuple:
    t = min(1.0, max(0.0, t))
    for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
        if t <= b:
            k = (t - a) / (b - a)
            return tuple(int(ca[i] + (cb[i] - ca[i]) * k) for i in range(3))
    return STOPS[-1][1]


def squircle_mask(size: int, n: float = 5.0) -> Image.Image:
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    u = np.abs((x + 0.5) / size * 2 - 1) / 0.94
    v = np.abs((y + 0.5) / size * 2 - 1) / 0.94
    return Image.fromarray(((u ** n + v ** n) <= 1).astype(np.uint8) * 255)


def draw(size: int = N) -> Image.Image:
    S = size * SS
    mask = squircle_mask(S)

    # background: deep night gradient with a soft magenta bloom behind the orb
    y = np.linspace(0, 1, S)[:, None]
    bg = np.zeros((S, S, 3), np.float32)
    bg[:] = (np.array([24, 18, 52]) * (1 - y)[..., None] + np.array([8, 7, 16]) * y[..., None])[:, :1, :]
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) / S
    bloom = np.exp(-(((xx - 0.5) ** 2 + (yy - 0.5) ** 2) / 0.09))
    bg += bloom[..., None] * np.array([90, 30, 110])
    img = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8)).convert("RGBA")

    glyphs = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(glyphs)
    cx, cy, R = S * 0.5, S * 0.52, S * 0.30
    cw, ch = S * 0.026, S * 0.042
    font = ImageFont.truetype(FONT, int(ch * 0.95), index=1)   # Menlo Bold
    light = np.array([-0.55, -0.62, 0.56])
    light /= np.linalg.norm(light)

    def ring_points(front: bool):
        rx, ry, tilt = S * 0.43, S * 0.105, np.radians(-16)
        for a in np.linspace(0, 2 * np.pi, 64, endpoint=False):
            px, py = rx * np.cos(a), ry * np.sin(a)
            x = cx + px * np.cos(tilt) - py * np.sin(tilt)
            yv = cy + px * np.sin(tilt) + py * np.cos(tilt)
            is_front = np.sin(a) > 0
            hidden = (not is_front) and (x - cx) ** 2 + (yv - cy) ** 2 < R ** 2
            if is_front == front and not hidden:
                t = 0.35 + 0.45 * (np.cos(a - 2.3) * 0.5 + 0.5)
                yield x, yv, "=" if is_front else "-", gradient(t), 255 if is_front else 150

    for x, yv, c, col, alpha in ring_points(front=False):
        d.text((x, yv), c, font=font, fill=col + (alpha,), anchor="mm")

    # the orb: each cell picks a character by how much light it catches
    for row in range(int((cy - R) / ch) - 1, int((cy + R) / ch) + 2):
        for col_i in range(int((cx - R) / cw) - 1, int((cx + R) / cw) + 2):
            x, yv = (col_i + 0.5) * cw, (row + 0.5) * ch
            nx, ny = (x - cx) / R, (yv - cy) / R
            r2 = nx * nx + ny * ny
            if r2 > 1:
                continue
            nz = np.sqrt(1 - r2)
            diff = max(0.0, nx * light[0] + ny * light[1] + nz * light[2])
            refl = 2 * diff * nz - light[2]
            spec = max(0.0, refl) ** 18
            rim = (1 - nz) ** 3 * 0.25           # a little back-light so the silhouette reads
            b = min(1.0, 0.16 + 0.76 * diff + 0.5 * spec + rim)
            c = RAMP[min(len(RAMP) - 1, int(b * (len(RAMP) - 1) + 0.5))]
            if c == " ":
                c = "."
            d.text((x, yv), c, font=font, fill=gradient(b) + (255,), anchor="mm")

    for x, yv, c, col, alpha in ring_points(front=True):
        d.text((x, yv), c, font=font, fill=col + (alpha,), anchor="mm")

    glow = glyphs.filter(ImageFilter.GaussianBlur(S * 0.012))
    img = Image.alpha_composite(img, glow)
    img = Image.alpha_composite(img, glow)
    img = Image.alpha_composite(img, glyphs)

    # glass: a soft highlight across the top, and a thin bright rim
    hl = Image.new("L", (S, S), 0)
    ImageDraw.Draw(hl).ellipse((-S * 0.2, -S * 0.7, S * 1.2, S * 0.3), fill=20)
    hl = hl.filter(ImageFilter.GaussianBlur(S * 0.06))
    img = Image.composite(Image.new("RGBA", (S, S), (255, 255, 255, 255)), img, hl)
    rim = mask.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(SS))
    img = Image.composite(Image.new("RGBA", (S, S), (255, 255, 255, 255)), img, rim.point(lambda v: int(v * 0.25)))

    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out.resize((size, size), Image.LANCZOS)


def main():
    logo = draw(N)
    logo.save(HERE / "logo-1024.png")
    for s in (16, 32, 48, 128, 180, 192, 512):
        logo.resize((s, s), Image.LANCZOS).save(HERE / f"icon-{s}.png")
    print("wrote", ", ".join(p.name for p in sorted(HERE.glob("*.png"))))


if __name__ == "__main__":
    main()

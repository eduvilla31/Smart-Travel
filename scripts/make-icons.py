"""Generate the PWA / home-screen icons (a map pin with sound waves)."""
import pathlib
from PIL import Image, ImageDraw

OUT = pathlib.Path(__file__).resolve().parent.parent / "public/icons"
OUT.mkdir(parents=True, exist_ok=True)

def icon(size, pad=0.0, rounded=True):
    s = 1024
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    bg = (15, 118, 110, 255)
    if rounded:
        d.rounded_rectangle([0, 0, s, s], radius=int(s * 0.22), fill=bg)
    else:
        d.rectangle([0, 0, s, s], fill=bg)
    k = 1 - pad * 2
    def P(x, y):
        return (s / 2 + (x - 512) * k, s / 2 + (y - 512) * k)
    # pin
    cx, cy, r = 430, 420, 190
    d.ellipse([*P(cx - r, cy - r), *P(cx + r, cy + r)], fill="white")
    d.polygon([P(cx - 165, cy + 95), P(cx + 165, cy + 95), P(cx, cy + 400)], fill="white")
    d.ellipse([*P(cx - 75, cy - 75), *P(cx + 75, cy + 75)], fill=bg)
    # sound waves
    for i, rr in enumerate((120, 210, 300)):
        box = [*P(640 - rr, 420 - rr), *P(640 + rr, 420 + rr)]
        d.arc(box, start=-40, end=40, fill=(253, 186, 116, 255), width=int(46 * k))
    return img.resize((size, size), Image.LANCZOS)

icon(192).save(OUT / "icon-192.png")
icon(512).save(OUT / "icon-512.png")
icon(512, pad=0.12, rounded=False).save(OUT / "icon-maskable-512.png")
icon(180, rounded=False).convert("RGB").save(OUT / "apple-touch-icon.png")
print("icons written")

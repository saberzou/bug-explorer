#!/usr/bin/env python3
"""
Render a 2D orthographic *approximation* of the Atlas globe view for review.

Not the live three.js output (no facet shading) — but it uses the real data:
the baked continent outlines, the real habitat-resolved pin positions, actual
bug thumbnails, and the rarity rim colors. Good enough to review composition,
geography, density, and theme.
"""
import json
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

import backfill_geo as geo  # reuse the exact habitat->coord rules + jitter

ROOT = Path(__file__).resolve().parents[1]
BUGS = json.loads((ROOT / "data" / "bugs.json").read_text())
LAND = json.loads((ROOT / "public" / "atlas" / "land.geo.json").read_text())

W = H = 1200
CX, CY = 600, 600
R = 430
# camera center (deg); override via CLI: render_atlas_preview.py LAT LNG OUT.png
VIEW_LAT = float(sys.argv[1]) if len(sys.argv) > 1 else 12.0
VIEW_LNG = float(sys.argv[2]) if len(sys.argv) > 2 else -30.0
OUT_NAME = sys.argv[3] if len(sys.argv) > 3 else "atlas_preview.png"

RIM = {"uncommon": (252, 211, 77), "rare": (125, 211, 252), "legendary": (251, 191, 36)}


def latlng_to_vec(lat, lng):
    phi = math.radians(lng + 180)
    theta = math.radians(90 - lat)
    return (
        -math.cos(phi) * math.sin(theta),
        math.cos(theta),
        math.sin(phi) * math.sin(theta),
    )


# camera basis
_cam = latlng_to_vec(VIEW_LAT, VIEW_LNG)
_up0 = (0.0, 1.0, 0.0)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(a):
    m = math.sqrt(sum(c * c for c in a)) or 1.0
    return (a[0] / m, a[1] / m, a[2] / m)


_right = _norm(_cross(_up0, _cam))
_true_up = _cross(_cam, _right)


def project(lat, lng, rad=1.0):
    """Return (sx, sy, z) — screen px and camera-facing depth (z>0 = front)."""
    p = latlng_to_vec(lat, lng)
    x = sum(p[i] * _right[i] for i in range(3))
    y = sum(p[i] * _true_up[i] for i in range(3))
    z = sum(p[i] * _cam[i] for i in range(3))
    # push back-facing points to the limb so polygons stay on the disc
    if z < 0:
        r = math.hypot(x, y) or 1e-6
        x, y = x / r, y / r
    return CX + x * R * rad, CY - y * R * rad, z


def circle_thumb(path, size):
    im = Image.open(path).convert("RGBA").resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
    im.putalpha(mask)
    return im


def font(sz):
    for p in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        if Path(p).exists():
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def main():
    img = Image.new("RGB", (W, H), (14, 13, 11))
    d = ImageDraw.Draw(img, "RGBA")

    # globe disc (paper)
    d.ellipse((CX - R, CY - R, CX + R, CY + R), fill=(231, 218, 189))
    # paper grain
    import random
    random.seed(7)
    for _ in range(16000):
        a = random.random()
        x = CX + (random.random() * 2 - 1) * R
        y = CY + (random.random() * 2 - 1) * R
        if (x - CX) ** 2 + (y - CY) ** 2 <= R * R:
            c = (90, 70, 40, int(a * 16)) if random.random() > 0.5 else (255, 250, 235, int(a * 16))
            d.point((x, y), fill=c)

    # land polygons
    feats = LAND["features"]
    for f in feats:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in polys:
            for ring in poly:
                pts = [project(lat, lng) for lng, lat in ring]
                if all(z < 0 for _, _, z in pts):
                    continue
                d.polygon([(x, y) for x, y, _ in pts], fill=(205, 185, 140, 235),
                          outline=(80, 62, 35, 160))

    # subtle limb shading ring
    d.ellipse((CX - R, CY - R, CX + R, CY + R), outline=(40, 32, 20, 120), width=3)

    # pins (resolve coords exactly like the app's region rules)
    placed = []
    for b in BUGS:
        hit = geo.locate(b["habitat"]) or (0.0, 0.0, "Unknown", "regional")
        lat0, lng0 = hit[0], hit[1]
        dlat, dlng = geo.jitter(b["slug"])
        lat, lng = lat0 + dlat, lng0 + dlng
        sx, sy, z = project(lat, lng, rad=1.06)
        ssx, ssy, _ = project(lat, lng, rad=1.0)
        placed.append((z, b, sx, sy, ssx, ssy))
    placed.sort(key=lambda t: t[0])  # far first

    for z, b, sx, sy, ssx, ssy in placed:
        if z <= 0.02:
            continue
        # stalk
        d.line((ssx, ssy, sx, sy), fill=(184, 146, 74, 220), width=2)
        size = int(40 + 10 * z)
        rim = RIM.get(b["rarity"])
        if rim:
            d.ellipse((sx - size / 2 - 3, sy - size / 2 - 3, sx + size / 2 + 3, sy + size / 2 + 3),
                      fill=rim + (255,))
        png = ROOT / "public" / "bugs" / f"{b['slug']}.png"
        if png.exists():
            thumb = circle_thumb(png, size)
            img.paste(thumb, (int(sx - size / 2), int(sy - size / 2)), thumb)
        else:
            d.ellipse((sx - size / 2, sy - size / 2, sx + size / 2, sy + size / 2), fill=(40, 40, 40))

    # header chrome
    d2 = ImageDraw.Draw(img, "RGBA")
    title = font(46)
    sub = font(20)
    tog = font(18)
    d2.text((CX, 56), "Bug Explorer", font=title, fill=(254, 243, 199), anchor="mm")
    d2.text((CX, 96), f"{len(BUGS)} specimens · drag to spin · open a cluster · tap to inspect",
            font=sub, fill=(161, 161, 170), anchor="mm")
    # toggle pill
    d2.rounded_rectangle((CX - 95, 120, CX + 95, 150), radius=15, fill=(0, 0, 0, 110),
                         outline=(82, 82, 91, 120))
    d2.text((CX - 48, 135), "Cabinet", font=tog, fill=(113, 113, 122), anchor="mm")
    d2.text((CX + 48, 135), "Atlas", font=tog, fill=(254, 243, 199), anchor="mm")

    out = ROOT / OUT_NAME
    img.save(out)
    print("wrote", out)


if __name__ == "__main__":
    main()

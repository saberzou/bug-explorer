#!/usr/bin/env python3
"""
Render a 2D orthographic *approximation* of the low-poly Atlas globe for review.

Not the live three.js output, but mirrors the real approach: a subdivided
icosphere (detail 3, matching the app), per-face land/ocean classification from
the baked continent outlines, flat per-face shading + paper-grain mottle, plus
the real habitat-resolved pin placements and bug thumbnails.
"""
import json
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

import backfill_geo as geo  # reuse the exact habitat->coord rules + jitter

ROOT = Path(__file__).resolve().parents[1]
BUGS = json.loads((ROOT / "data" / "bugs.json").read_text())
LAND = json.loads((ROOT / "public" / "atlas" / "land.geo.json").read_text())

W = H = 1200
CX, CY = 600, 600
R = 430
DETAIL = 3
VIEW_LAT = float(sys.argv[1]) if len(sys.argv) > 1 else 12.0
VIEW_LNG = float(sys.argv[2]) if len(sys.argv) > 2 else -30.0
OUT_NAME = sys.argv[3] if len(sys.argv) > 3 else "atlas_preview.png"

RIM = {"uncommon": (252, 211, 77), "rare": (125, 211, 252), "legendary": (251, 191, 36)}
OCEAN = (231, 216, 189)
LANDC = (190, 160, 110)
LIGHT = (0.651, 0.39, 0.651)  # normalized directional light (5,3,5)


def latlng_to_vec(lat, lng):
    phi = math.radians(lng + 180)
    theta = math.radians(90 - lat)
    return (-math.cos(phi) * math.sin(theta), math.cos(theta), math.sin(phi) * math.sin(theta))


def vec_to_latlng(x, y, z):
    lat = 90 - math.degrees(math.acos(max(-1, min(1, y))))
    lng = math.degrees(math.atan2(z, -x)) - 180
    if lng < -180:
        lng += 360
    return lat, lng


# camera basis
_cam = latlng_to_vec(VIEW_LAT, VIEW_LNG)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(a):
    m = math.sqrt(sum(c * c for c in a)) or 1.0
    return (a[0] / m, a[1] / m, a[2] / m)


_right = _norm(_cross((0, 1, 0), _cam))
_true_up = _cross(_cam, _right)


def project(lat, lng, rad=1.0):
    p = latlng_to_vec(lat, lng)
    x = sum(p[i] * _right[i] for i in range(3))
    y = sum(p[i] * _true_up[i] for i in range(3))
    z = sum(p[i] * _cam[i] for i in range(3))
    if z < 0:
        r = math.hypot(x, y) or 1e-6
        x, y = x / r, y / r
    return CX + x * R * rad, CY - y * R * rad, z


def project_vec(v):
    x = sum(v[i] * _right[i] for i in range(3))
    y = sum(v[i] * _true_up[i] for i in range(3))
    z = sum(v[i] * _cam[i] for i in range(3))
    return CX + x * R, CY - y * R, z


# --- icosphere ---------------------------------------------------------------
def build_icosphere(detail):
    t = (1 + math.sqrt(5)) / 2
    verts = [
        (-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0),
        (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t),
        (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1),
    ]
    verts = [_norm(v) for v in verts]
    faces = [
        (0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
        (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
        (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
        (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1),
    ]
    tris = [tuple(verts[i] for i in f) for f in faces]
    for _ in range(detail):
        out = []
        for a, b, c in tris:
            ab = _norm(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2))
            bc = _norm(((b[0] + c[0]) / 2, (b[1] + c[1]) / 2, (b[2] + c[2]) / 2))
            ca = _norm(((c[0] + a[0]) / 2, (c[1] + a[1]) / 2, (c[2] + a[2]) / 2))
            out += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        tris = out
    return tris


def point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def is_land(lng, lat):
    for f in LAND["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in polys:
            if poly and point_in_ring(lng, lat, poly[0]):
                if not any(point_in_ring(lng, lat, poly[k]) for k in range(1, len(poly))):
                    return True
    return False


def rand01(seed):
    t = (seed * 2654435761) & 0xFFFFFFFF
    t ^= t >> 13
    t = (t * 1274126177) & 0xFFFFFFFF
    return ((t ^ (t >> 16)) & 0xFFFFFFFF) / 0xFFFFFFFF


def circle_thumb(path, size):
    im = Image.open(path).convert("RGBA").resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
    im.putalpha(mask)
    return im


def font(sz):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        if Path(p).exists():
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def spread(clat, clng, i, n):
    """Sunflower-spread member i of n around a region centroid (degrees)."""
    if n <= 1:
        return clat, clng
    golden = 2.399963229728653
    step = 8.5
    r = step * math.sqrt(i + 0.5)
    a = i * golden
    d_lat = r * math.sin(a)
    d_lng = (r * math.cos(a)) / max(0.35, math.cos(math.radians(clat)))
    return max(-85, min(85, clat + d_lat)), clng + d_lng


def main():
    img = Image.new("RGB", (W, H), (14, 13, 11))
    d = ImageDraw.Draw(img, "RGBA")

    # low-poly faceted globe
    tris = build_icosphere(DETAIL)
    drawn = []
    for idx, (a, b, c) in enumerate(tris):
        cen = _norm(((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3))
        za = sum(cen[i] * _cam[i] for i in range(3))
        if za <= 0:
            continue
        lat, lng = vec_to_latlng(*cen)
        base = LANDC if is_land(lng, lat) else OCEAN
        mottle = (rand01(idx) * 2 - 1) * 0.05
        ndotl = max(0.0, sum(cen[i] * LIGHT[i] for i in range(3)))
        shade = max(0.0, min(1.0, 0.55 + 0.6 * ndotl + mottle))
        col = tuple(max(0, min(255, int(ch * shade))) for ch in base)
        pa, pb, pc = project_vec(a), project_vec(b), project_vec(c)
        drawn.append((za, [(pa[0], pa[1]), (pb[0], pb[1]), (pc[0], pc[1])], col))
    drawn.sort(key=lambda t: t[0])
    for _, pts, col in drawn:
        d.polygon(pts, fill=col, outline=col)

    # group by region, spread members, collect labels
    from collections import defaultdict
    regions = defaultdict(list)
    for b in BUGS:
        hit = geo.locate(b["habitat"]) or (0.0, 0.0, "Unknown", "regional")
        regions[(hit[2], hit[0], hit[1])].append(b)

    placed = []
    labels = []
    for (region, clat, clng), members in regions.items():
        n = len(members)
        for i, b in enumerate(members):
            lat, lng = spread(clat, clng, i, n)
            sx, sy, z = project(lat, lng, rad=1.07)
            ssx, ssy, _ = project(lat, lng, rad=1.0)
            placed.append((z, b, sx, sy, ssx, ssy))
        llat = min(88, clat + 8.5 * math.sqrt(n) + 7)
        lx, ly, lz = project(llat, clng, rad=1.05)
        labels.append((lz, region, lx, ly))
    placed.sort(key=lambda t: t[0])

    for z, b, sx, sy, ssx, ssy in placed:
        if z <= 0.02:
            continue
        d.line((ssx, ssy, sx, sy), fill=(184, 146, 74, 220), width=2)
        size = int(24 + 10 * z)
        png = ROOT / "public" / "bugs" / f"{b['slug']}.png"
        if png.exists():
            thumb = circle_thumb(png, size)
            img.paste(thumb, (int(sx - size / 2), int(sy - size / 2)), thumb)
        rim = RIM.get(b["rarity"])
        if rim:  # hairline rim
            d.ellipse((sx - size / 2, sy - size / 2, sx + size / 2, sy + size / 2),
                      outline=rim + (255,), width=2)

    # spotlight popup on the front-most bug (mirrors the live auto-highlight)
    front = [t for t in placed if t[0] > 0.35]
    if front:
        _z, b, sx, sy, _ssx, _ssy = max(front, key=lambda t: t[0])
        region = (geo.locate(b["habitat"]) or (0, 0, "Unknown", "r"))[2]
        big = 84
        png = ROOT / "public" / "bugs" / f"{b['slug']}.png"
        if png.exists():
            thumb = circle_thumb(png, big)
            img.paste(thumb, (int(sx - big / 2), int(sy - big / 2)), thumb)
        rim = RIM.get(b["rarity"])
        if rim:
            d.ellipse((sx - big / 2, sy - big / 2, sx + big / 2, sy + big / 2),
                      outline=rim + (255,), width=3)
        name, reg = b["commonName"], region.upper()
        nf, rf = font(26), font(15)
        nw = nf.getbbox(name)[2]
        rw = rf.getbbox(reg)[2]
        cardw = max(nw, rw) + 34 + 40
        cardh = 60
        cx0 = sx - cardw / 2
        cy0 = sy - big / 2 - cardh - 14
        d.rounded_rectangle((cx0, cy0, cx0 + cardw, cy0 + cardh), radius=14,
                            fill=(10, 9, 8, 235), outline=(251, 191, 36, 90))
        d.text((cx0 + 16, cy0 + 15), name, font=nf, fill=(254, 243, 199))
        d.text((cx0 + 16, cy0 + 39), reg, font=rf, fill=(161, 161, 170))
        icx, icy = cx0 + cardw - 25, cy0 + cardh / 2
        d.ellipse((icx - 13, icy - 13, icx + 13, icy + 13), outline=(251, 191, 36, 200), width=2)
        d.text((icx, icy), "i", font=font(17), fill=(254, 243, 199), anchor="mm")

    # header
    d2 = ImageDraw.Draw(img, "RGBA")
    d2.text((CX, 56), "Bug Explorer", font=font(46), fill=(254, 243, 199), anchor="mm")
    d2.text((CX, 96), f"{len(BUGS)} specimens · drag to spin · pinch to zoom · tap to inspect",
            font=font(20), fill=(161, 161, 170), anchor="mm")
    d2.rounded_rectangle((CX - 95, 120, CX + 95, 150), radius=15, fill=(0, 0, 0, 110),
                         outline=(82, 82, 91, 120))
    d2.text((CX - 48, 135), "Cabinet", font=font(18), fill=(113, 113, 122), anchor="mm")
    d2.text((CX + 48, 135), "Atlas", font=font(18), fill=(254, 243, 199), anchor="mm")

    out = ROOT / OUT_NAME
    img.save(out)
    print("wrote", out)


if __name__ == "__main__":
    main()

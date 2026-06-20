#!/usr/bin/env python3
"""
Thumbnail audit for the two display rules Saber cares about (2026-06-20):

  RULE 1 - SQUARE, NO BAKED-IN CIRCLE.
      Each PNG must be a true square whose cream/beige background fills the
      WHOLE frame edge-to-edge (all four corners). It must NOT have a circular
      or oval "parchment cutout" / vignette baked in, and must NOT have a
      drawn ring/outline wrapping the bug. The site draws the circle (CSS
      `rounded-full overflow-hidden`); a circle baked into the pixels would
      double up and look wrong.

  RULE 2 - BUG FITS INSIDE THE INSCRIBED CIRCLE.
      The grid + detail hero crop every thumbnail to the inscribed circle
      (diameter == image width). So the entire insect - every leg, antenna,
      wing, tail, and its drop shadow - must sit inside that circle with
      margin, or the mask amputates it.

This is a *reporting* tool: it classifies each thumbnail and prints a verdict so
we can decide what to delete + regenerate. It does NOT delete anything.

The crop check (RULE 2) and the plate/coverage logic mirror
scripts/validate_bug.py so the two stay consistent; this script adds the
explicit RULE-1 detectors (corner solid-fill + baked-ring/vignette-with-moat).

Usage:
    python3 scripts/audit_thumbnails.py              # audit every thumbnail
    python3 scripts/audit_thumbnails.py --slug picasso-bug
    python3 scripts/audit_thumbnails.py --json       # JSON lines for tooling
    python3 scripts/audit_thumbnails.py --fail-only  # only show offenders
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUGS_PATH = ROOT / "data" / "bugs.json"
THUMBS_DIR = ROOT / "public" / "bugs"

# ---- tuning (kept in sync with validate_bug.py where they overlap) --------
MIN_DIM = 1024
ANALYZE = 320
BG_DIST_THRESH = 40
SAFE_RADIUS_FRAC = 0.94
EDGE_SUBJECT_TOL = 0.004
PLATE_MIN_LUMA = 150
MIN_COVERAGE = 0.04
MAX_COVERAGE = 0.85

# ---- RULE-1 specific tuning -----------------------------------------------
CORNER_MATCH_DIST = 26.0
CORNER_STDDEV_MAX = 18.0
CORNER_MIN_LUMA = 140
CORNER_FILL_MIN = 3

# Baked-ring / round-vignette EDGE: subject pixels in an outer band near the
# circle edge that have a clear cream "moat" of background just inside them.
# A bug merely bleeding to the edge has no moat (subject runs continuously from
# the center), so it is NOT counted here - that is a RULE-2 crop, not a baked
# circle.
RING_R_IN = 0.80
RING_R_OUT = 0.99
MOAT_R_IN = 0.55
MOAT_R_OUT = 0.74
RING_SAMPLES = 360
RING_COVER_FRAC = 0.55   # >=55% of spokes are ring-with-moat => baked ring/vignette


def luma(rgb) -> float:
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def cdist(a, b) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def analyze(path: Path) -> dict:
    from PIL import Image

    res: dict = {"issues": [], "notes": []}
    with Image.open(path) as im0:
        w, h = im0.size
        res["size"] = [w, h]
        if w != h:
            res["issues"].append(f"NOT_SQUARE:{w}x{h}")
        if min(w, h) < MIN_DIM:
            res["issues"].append(f"TOO_SMALL:{w}x{h}<{MIN_DIM}")
        im = im0.convert("RGB").resize((ANALYZE, ANALYZE), Image.LANCZOS)

    px = im.load()
    n = ANALYZE
    k = max(8, n // 32)

    # global background from 4 corner blocks
    corners = {}
    all_corner_px = []
    for name, (cx, cy) in {
        "tl": (0, 0), "tr": (n - k, 0), "bl": (0, n - k), "br": (n - k, n - k),
    }.items():
        block = [px[x, y] for y in range(cy, cy + k) for x in range(cx, cx + k)]
        mean = tuple(sum(c[i] for c in block) / len(block) for i in range(3))
        var = [sum((c[i] - mean[i]) ** 2 for c in block) / len(block) for i in range(3)]
        sd = max(math.sqrt(v) for v in var)
        corners[name] = {"mean": mean, "sd": sd, "luma": luma(mean)}
        all_corner_px.extend(block)
    bg = tuple(sum(c[i] for c in all_corner_px) / len(all_corner_px) for i in range(3))
    res["bg"] = [round(x, 1) for x in bg]

    # RULE 1a: are all four corners a solid bright cream fill?
    filled = 0
    corner_detail = {}
    for name, c in corners.items():
        ok = (cdist(c["mean"], bg) <= CORNER_MATCH_DIST
              and c["sd"] <= CORNER_STDDEV_MAX
              and c["luma"] >= CORNER_MIN_LUMA)
        corner_detail[name] = {
            "luma": round(c["luma"], 1), "sd": round(c["sd"], 1),
            "dist_bg": round(cdist(c["mean"], bg), 1), "filled": ok,
        }
        if ok:
            filled += 1
    res["corners"] = corner_detail
    res["corners_filled"] = filled

    is_plate = filled >= CORNER_FILL_MIN and luma(bg) >= PLATE_MIN_LUMA

    if filled <= 2:
        # Two or more corners are dark/empty/non-matching => the cream area is a
        # round vignette (or it's a photo), not a true square fill. This is the
        # reliable RULE-1 violation signal.
        dark = [nm for nm, d in corner_detail.items() if not d["filled"]]
        res["issues"].append(f"CORNERS_NOT_FILLED:{','.join(dark)}")
    elif filled == 3:
        # 3/4 cream corners: usually a benign soft tonal falloff in one corner,
        # not a baked circle. Advisory only.
        dark = [nm for nm, d in corner_detail.items() if not d["filled"]]
        res["notes"].append(f"one_corner_off:{','.join(dark)}(advisory)")

    # geometry
    center = (n - 1) / 2.0
    radius = n / 2.0
    safe_r = radius * SAFE_RADIUS_FRAC

    subject = 0
    beyond_safe = 0
    max_r_norm = 0.0
    for y in range(n):
        dy = y - center
        for x in range(n):
            if cdist(px[x, y], bg) <= BG_DIST_THRESH:
                continue
            subject += 1
            rr = math.hypot(x - center, dy) / radius
            if rr > max_r_norm:
                max_r_norm = rr
            if rr * radius > safe_r:
                beyond_safe += 1

    inscribed_area = math.pi * radius * radius
    coverage = subject / inscribed_area if inscribed_area else 0.0
    beyond_frac = beyond_safe / (n * n)
    res["coverage"] = round(coverage, 3)
    res["beyond_safe_frac"] = round(beyond_frac, 4)
    res["max_reach"] = round(max_r_norm, 3)

    # RULE 1b: baked ring / round-vignette edge (subject near edge WITH a cream
    # moat just inside it). See tuning notes above.
    def sample_subject(cos_a, sin_a, rr):
        x = center + cos_a * rr * radius
        y = center + sin_a * rr * radius
        xi, yi = int(round(x)), int(round(y))
        if 0 <= xi < n and 0 <= yi < n:
            return cdist(px[xi, yi], bg) > BG_DIST_THRESH
        return None

    lit = 0
    ring_any = 0
    for s in range(RING_SAMPLES):
        ang = 2 * math.pi * s / RING_SAMPLES
        cos_a, sin_a = math.cos(ang), math.sin(ang)

        outer_hit = False
        rr = RING_R_IN
        while rr <= RING_R_OUT:
            if sample_subject(cos_a, sin_a, rr):
                outer_hit = True
                break
            rr += 0.02
        if outer_hit:
            ring_any += 1

        moat_bg = False
        rr = MOAT_R_IN
        while rr <= MOAT_R_OUT:
            if sample_subject(cos_a, sin_a, rr) is False:
                moat_bg = True
                break
            rr += 0.02

        if outer_hit and moat_bg:
            lit += 1

    ring_cover = lit / RING_SAMPLES
    res["ring_cover"] = round(ring_cover, 3)
    res["edge_band_cover"] = round(ring_any / RING_SAMPLES, 3)
    # NOTE: the ring-with-moat signal is ADVISORY only. Ground-truth (vision +
    # radial luma profiling, 2026-06-20) showed it false-positives when cream
    # gaps between a bug's own parts (wings/legs) read as a moat. The reliable
    # RULE-1 signal is CORNERS_NOT_FILLED (dark/empty corners => round vignette
    # or photo). Keep ring as a note for a human glance, not a hard fail.
    if ring_cover >= RING_COVER_FRAC:
        res["notes"].append(f"ring_with_moat={ring_cover:.0%}(advisory)")

    # RULE 2: crop / coverage (mirror the gate)
    if is_plate:
        if coverage < MIN_COVERAGE:
            res["issues"].append(f"BLANK:coverage={coverage:.0%}")
        elif coverage > MAX_COVERAGE:
            res["issues"].append(f"BLEEDING:coverage={coverage:.0%}")
        if beyond_frac > EDGE_SUBJECT_TOL:
            res["issues"].append(
                f"CROPPED_BY_CIRCLE:beyond={beyond_frac:.1%},reach={max_r_norm:.2f}")
        elif max_r_norm > SAFE_RADIUS_FRAC:
            res["notes"].append(f"tight:reach={max_r_norm:.2f}")
    else:
        res["notes"].append("non-plate(photographic?) - circle-safety unverifiable")
        if coverage < 0.02:
            res["issues"].append(f"BLANK:coverage={coverage:.0%}")

    res["ok"] = len(res["issues"]) == 0
    return res


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--fail-only", action="store_true")
    args = ap.parse_args()

    try:
        from PIL import Image  # noqa: F401
    except ModuleNotFoundError:
        sys.exit("Pillow required: pip install pillow")

    bugs = json.loads(BUGS_PATH.read_text())
    slugs = [b["slug"] for b in bugs]
    if args.slug:
        if args.slug not in slugs:
            sys.exit(f"unknown slug {args.slug!r}")
        slugs = [args.slug]

    results = {}
    for slug in slugs:
        path = THUMBS_DIR / f"{slug}.png"
        if not path.exists():
            results[slug] = {"ok": False, "issues": ["MISSING_PNG"], "notes": []}
            continue
        results[slug] = analyze(path)

    offenders = {s: r for s, r in results.items() if not r["ok"]}

    if args.json:
        for slug, r in results.items():
            if args.fail_only and r["ok"]:
                continue
            print(json.dumps({"slug": slug, **r}))
    else:
        for slug, r in results.items():
            if args.fail_only and r["ok"]:
                continue
            mark = "OK  " if r["ok"] else "FAIL"
            extra = "" if r["ok"] else "  " + " | ".join(r["issues"])
            print(f"{mark}  {slug}{extra}")
        print()
        print(f"RESULT: {len(offenders)} of {len(results)} thumbnails flagged.")
        if offenders:
            print("Flagged slugs: " + " ".join(sorted(offenders)))

    return 1 if offenders else 0


if __name__ == "__main__":
    sys.exit(main())

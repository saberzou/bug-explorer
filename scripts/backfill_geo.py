#!/usr/bin/env python3
"""
Backfill approximate geographic coordinates for the Atlas (globe) view.

Habitats in data/bugs.json are free-text regions, not points. This maps each
habitat phrase to a representative centroid + a coarse `rangeKind`, writing
data/bug_geo.json keyed by slug:

    { "<slug>": { "lat": <deg>, "lng": <deg>, "region": "...",
                  "rangeKind": "point" | "regional" | "cosmopolitan" } }

A deterministic per-slug jitter spreads co-located species so pins in the same
region don't stack into one dot. This is a prototype backfill — coordinates are
approximate; refine the obvious ones by hand (Atticus/Axel) over time.
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUGS = ROOT / "data" / "bugs.json"
OUT = ROOT / "data" / "bug_geo.json"

# Ordered (regex, lat, lng, region, rangeKind). FIRST match wins, so list the
# most specific phrases before the broad fallbacks.
RULES = [
    (r"papua new guinea|oro province",   -6.5, 147.0, "Papua New Guinea", "point"),
    (r"new guinea|indonesian islands",   -5.5, 141.0, "New Guinea", "regional"),
    (r"new zealand",                     -41.5, 172.5, "New Zealand", "point"),
    (r"madagasc",                        -19.0,  46.7, "Madagascar", "point"),
    (r"andes|peru|bolivia|ecuador",      -12.0, -75.5, "The Andes", "regional"),
    (r"brazil|atlantic rainforest",      -14.0, -51.0, "Brazil", "regional"),
    (r"amazon",                           -4.0, -62.0, "Amazon Basin", "regional"),
    (r"central america",                  12.5, -85.0, "Central America", "regional"),
    (r"neotropic|central & south america|central and south america|south america",
                                          -6.0, -60.0, "Central & South America", "regional"),
    (r"southeast asia",                    4.5, 110.0, "Southeast Asia", "regional"),
    (r"central asia",                     45.0,  68.0, "Central Asia", "regional"),
    (r"japan|china|east asia|korea",      34.0, 112.0, "East Asia", "regional"),
    (r"sub-saharan|tropical africa",       1.0,  21.0, "Sub-Saharan Africa", "regional"),
    (r"southern africa",                 -25.0,  25.0, "Southern Africa", "regional"),
    (r"southeastern north america|southeast(ern)? (united states|us)",
                                          32.5, -83.5, "SE North America", "regional"),
    (r"eastern north america|eastern (united states|us|u\.s\.)",
                                          40.0, -80.0, "Eastern North America", "regional"),
    (r"western north america",            41.0, -114.0, "Western North America", "regional"),
    (r"north america",                    39.0, -98.0, "North America", "regional"),
    (r"alpine|high-altitude",             46.5,  10.5, "Alpine Europe", "regional"),
    (r"europe",                           50.0,  10.0, "Europe", "regional"),
    (r"australia",                       -28.0, 140.0, "Australia", "regional"),
    (r"\basia\b",                         30.0,  95.0, "Asia", "regional"),
    (r"africa",                            3.0,  20.0, "Africa", "regional"),
    (r"eurasia",                          50.0,  60.0, "Eurasia", "regional"),
    (r"holarctic|northern hemisphere",    48.0,  20.0, "Northern Hemisphere", "regional"),
    (r"worldwide|cosmopolitan|domesticated|global",
                                          20.0,  15.0, "Worldwide", "cosmopolitan"),
    (r"tropic",                            0.0,  12.0, "Tropics", "regional"),
]


def jitter(slug: str):
    """Deterministic ±degrees offset from the slug, so co-located pins spread."""
    h = hashlib.md5(slug.encode()).digest()
    dlat = (h[0] / 255 - 0.5) * 7.0   # ±3.5°
    dlng = (h[1] / 255 - 0.5) * 9.0   # ±4.5°
    return dlat, dlng


def locate(habitat: str):
    h = habitat.lower()
    for pat, lat, lng, region, kind in RULES:
        if re.search(pat, h):
            return lat, lng, region, kind
    return None


def main():
    bugs = json.loads(BUGS.read_text())
    out = {}
    unmatched = []
    for b in bugs:
        hit = locate(b["habitat"])
        if not hit:
            unmatched.append((b["slug"], b["habitat"]))
            # Fallback near the equator so it's visible but obviously generic.
            lat, lng, region, kind = 0.0, 0.0, "Unknown", "regional"
        else:
            lat, lng, region, kind = hit
        dlat, dlng = jitter(b["slug"])
        out[b["slug"]] = {
            "lat": round(lat + dlat, 3),
            "lng": round(lng + dlng, 3),
            "region": region,
            "rangeKind": kind,
        }

    OUT.write_text(json.dumps(out, indent=2))
    print(f"wrote {len(out)} coords to {OUT.relative_to(ROOT)}")
    if unmatched:
        print(f"\n⚠️  {len(unmatched)} unmatched habitats (assigned 0,0 — add a rule):")
        for slug, hab in unmatched:
            print(f"   {slug}: {hab}")
    # region histogram
    from collections import Counter
    hist = Counter(v["region"] for v in out.values())
    print("\nregion distribution:")
    for r, n in hist.most_common():
        print(f"  {n:3}  {r}")


if __name__ == "__main__":
    main()

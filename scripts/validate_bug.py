#!/usr/bin/env python3
"""
Daily-curation validation gate for Bug Explorer.

This is the hard gate the daily content job MUST pass before it commits a new
specimen. It enforces the two things that keep the collection trustworthy:

  1. NO DUPLICATES — the new bug must be a genuinely new species (unique slug,
     common name, and Latin binomial vs. everything already in data/bugs.json).
  2. IMAGE QUALITY + STAYS IN THE CIRCLE — the thumbnail must be a square,
     high-resolution PNG, and (for the cream-plate illustration style) the
     insect — including all legs, antennae, wings, and tails — must sit inside
     the inscribed circle with margin, so the grid's circular crop never
     amputates it.

Exit status is 0 only when every checked specimen passes. Any FAIL → exit 1,
so the job can gate on `python3 scripts/validate_bug.py && git commit ...`.

Usage:
    python3 scripts/validate_bug.py                 # validate the latest cohort
    python3 scripts/validate_bug.py --slug atlas-moth
    python3 scripts/validate_bug.py --date 2026-06-14
    python3 scripts/validate_bug.py --all           # full sweep (CI / backfill)
    python3 scripts/validate_bug.py --all --no-image  # schema/dedup only
    python3 scripts/validate_bug.py --frontier        # daily add: also require frontier date

Image checks need Pillow:  pip install pillow
(If Pillow is missing the image checks are skipped with a loud warning; the
daily job should treat a skipped image check as a failure — see the runbook.)
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import unicodedata
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUGS_PATH = ROOT / "data" / "bugs.json"
THUMBS_DIR = ROOT / "public" / "bugs"

RARITIES = {"common", "uncommon", "rare", "legendary"}
SIZE_KINDS = {"body", "wingspan"}

# ---- image gate tuning ----------------------------------------------------
MIN_DIM = 1024            # thumbnails must be at least this on each side
ANALYZE = 256             # downscale to this for pixel analysis (speed)
BG_DIST_THRESH = 40       # RGB distance from background to count a pixel as "subject"
SAFE_RADIUS_FRAC = 0.94   # subject must stay within this fraction of the circle radius
EDGE_SUBJECT_TOL = 0.004  # fraction of pixels allowed beyond the safe radius (noise)
PLATE_CORNER_STDDEV_MAX = 16.0  # corners at most this noisy => "cream plate" layout
PLATE_MIN_LUMA = 150            # ...and at least this bright => plate (vs. photo)
MIN_COVERAGE = 0.04       # below this the generation is effectively blank/failed
MAX_COVERAGE = 0.85       # above this the subject is bleeding to the edge


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def norm_name(s: str) -> str:
    """Normalise a name for duplicate comparison: lowercase, strip accents and
    punctuation, collapse whitespace."""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def luma(rgb) -> float:
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def color_dist(a, b) -> float:
    return math.sqrt(
        (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
    )


class Report:
    def __init__(self, slug: str):
        self.slug = slug
        self.errors: list[str] = []
        self.warns: list[str] = []

    def err(self, msg: str):
        self.errors.append(msg)

    def warn(self, msg: str):
        self.warns.append(msg)

    @property
    def ok(self) -> bool:
        return not self.errors

    def render(self) -> str:
        head = f"{'✓' if self.ok else '✗'} {self.slug}"
        lines = [head]
        for e in self.errors:
            lines.append(f"    FAIL  {e}")
        for w in self.warns:
            lines.append(f"    warn  {w}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# schema + dedup
# ---------------------------------------------------------------------------
REQUIRED_STR = ["slug", "commonName", "latinName", "habitat", "weirdFact",
                "whyItsCool", "discoveredOn"]


def validate_schema(bug: dict, rep: Report) -> None:
    for key in REQUIRED_STR:
        v = bug.get(key)
        if not isinstance(v, str) or not v.strip():
            rep.err(f"missing/empty required string field: {key!r}")

    slug = bug.get("slug", "")
    if slug and not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
        rep.err(f"slug must be kebab-case [a-z0-9-]: {slug!r}")

    size = bug.get("sizeMm")
    if not isinstance(size, (int, float)) or isinstance(size, bool) or size <= 0:
        rep.err(f"sizeMm must be a positive number, got {size!r}")

    if bug.get("sizeKind") not in SIZE_KINDS:
        rep.err(f"sizeKind must be one of {sorted(SIZE_KINDS)}, got {bug.get('sizeKind')!r}")

    if bug.get("rarity") not in RARITIES:
        rep.err(f"rarity must be one of {sorted(RARITIES)}, got {bug.get('rarity')!r}")

    d = bug.get("discoveredOn", "")
    try:
        datetime.strptime(d, "%Y-%m-%d")
    except ValueError:
        rep.err(f"discoveredOn must be ISO YYYY-MM-DD, got {d!r}")

    latin = bug.get("latinName", "")
    if latin and len(latin.split()) < 2:
        rep.warn(f"latinName looks non-binomial: {latin!r}")

    wf = bug.get("weirdFact", "")
    if len(wf) > 220:
        rep.warn(f"weirdFact is long ({len(wf)} chars; aim <=140)")
    wc = bug.get("whyItsCool", "")
    if len(wc) > 240:
        rep.warn(f"whyItsCool is long ({len(wc)} chars; aim <=160)")

    palette = bug.get("colorPalette")
    if palette is not None:
        if (not isinstance(palette, list) or len(palette) != 3
                or not all(isinstance(c, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", c) for c in palette)):
            rep.err(f"colorPalette must be 3 hex colors like ['#1B4F8C', ...], got {palette!r}")


def validate_dedup(bug: dict, others: list[dict], rep: Report) -> None:
    slug = bug.get("slug", "")
    common = norm_name(bug.get("commonName", ""))
    latin = norm_name(bug.get("latinName", ""))

    for o in others:
        if o.get("slug") == slug:
            rep.err(f"duplicate slug already in collection: {slug!r}")
        if common and norm_name(o.get("commonName", "")) == common:
            rep.err(f"duplicate common name vs {o.get('slug')!r}: {bug.get('commonName')!r}")
        if latin and norm_name(o.get("latinName", "")) == latin:
            rep.err(f"duplicate Latin name vs {o.get('slug')!r}: {bug.get('latinName')!r}")

    # Soft signal: same genus (first token of the binomial). Allowed, but the
    # collection is meant to feel varied, so flag it for a human glance.
    genus = latin.split()[0] if latin else ""
    if genus:
        same = [o.get("slug") for o in others
                if norm_name(o.get("latinName", "")).split()[:1] == [genus]]
        if same:
            rep.warn(f"same genus ({genus!r}) as {same} — fine, but watch variety")


# ---------------------------------------------------------------------------
# frontier gate (opt-in)
# ---------------------------------------------------------------------------
def validate_frontier(bug: dict, others: list[dict], rep: Report) -> None:
    """Enforce the forward-only invariant for a *new* daily specimen: its
    ``discoveredOn`` must land at the frontier, i.e. strictly after the latest
    date already in the collection. This turns the runbook's
    ``discoveredOn = max(today, latest + 1 day)`` rule into a hard gate so a new
    bug can never be stamped mid-timeline.

    Opt-in via --frontier. It is intentionally NOT applied to --all sweeps,
    --date spot-checks, backfills of older species, or the CI push/PR gate (all
    of which legitimately validate non-frontier rows — e.g. same-day cohorts or
    legacy dates); only the daily-add commit step passes --frontier.
    """
    dates = [o.get("discoveredOn", "") for o in others]
    dates = [d for d in dates if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d or "")]
    if not dates:
        return  # first ever specimen — nothing to be ahead of
    latest = max(dates)
    mine = bug.get("discoveredOn", "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", mine or ""):
        return  # schema check already flagged the bad date
    if mine <= latest:
        rep.err(
            f"discoveredOn {mine!r} is not at the frontier: the collection "
            f"already reaches {latest!r}. A new specimen must land strictly after "
            f"the latest date (set discoveredOn = max(today, {latest} + 1 day)). "
            f"This keeps the grid forward-only; re-date the new bug, don't "
            f"insert it mid-timeline."
        )


# ---------------------------------------------------------------------------
# image gate
# ---------------------------------------------------------------------------
def validate_image(slug: str, rep: Report) -> None:
    path = THUMBS_DIR / f"{slug}.png"
    if not path.exists():
        rep.err(f"thumbnail missing: public/bugs/{slug}.png")
        return

    try:
        from PIL import Image
    except ModuleNotFoundError:
        rep.warn("Pillow not installed — IMAGE CHECKS SKIPPED (pip install pillow). "
                 "Treat as a failure for the daily job.")
        return

    with Image.open(path) as im0:
        w, h = im0.size
        if w != h:
            rep.err(f"image not square: {w}x{h}")
        if min(w, h) < MIN_DIM:
            rep.err(f"image too small: {w}x{h} (need >= {MIN_DIM} per side)")
        im = im0.convert("RGB").resize((ANALYZE, ANALYZE), Image.LANCZOS)

    px = im.load()
    n = ANALYZE

    # Background estimate from the four corners (the plate's cream fill, or the
    # photo's corner content). Sample 10x10 blocks.
    k = 10
    corner_pixels = []
    for (cx, cy) in [(0, 0), (n - k, 0), (0, n - k), (n - k, n - k)]:
        for y in range(cy, cy + k):
            for x in range(cx, cx + k):
                corner_pixels.append(px[x, y])
    bg = tuple(sum(c[i] for c in corner_pixels) / len(corner_pixels) for i in range(3))
    # Corner uniformity (max channel stddev) → is this a clean plate?
    var = [sum((c[i] - bg[i]) ** 2 for c in corner_pixels) / len(corner_pixels) for i in range(3)]
    corner_stddev = max(math.sqrt(v) for v in var)
    is_plate = corner_stddev <= PLATE_CORNER_STDDEV_MAX and luma(bg) >= PLATE_MIN_LUMA

    center = (n - 1) / 2.0
    radius = n / 2.0
    safe_r = radius * SAFE_RADIUS_FRAC

    subject = 0
    beyond_safe = 0
    max_r_norm = 0.0
    for y in range(n):
        for x in range(n):
            if color_dist(px[x, y], bg) <= BG_DIST_THRESH:
                continue
            subject += 1
            rr = math.hypot(x - center, y - center) / radius  # 1.0 == circle edge
            if rr > max_r_norm:
                max_r_norm = rr
            if rr * radius > safe_r:
                beyond_safe += 1

    inscribed_area = math.pi * radius * radius
    coverage = subject / inscribed_area if inscribed_area else 0.0
    beyond_frac = beyond_safe / (n * n)

    if not is_plate:
        rep.warn(
            "photographic composition (non-uniform corners): circle-safety can't "
            "be verified — prefer the cream-plate illustration style for new bugs"
        )
        if coverage < 0.02:
            rep.err(f"image looks blank/near-empty (coverage {coverage:.0%})")
        return

    # Plate-style checks ----------------------------------------------------
    if coverage < MIN_COVERAGE:
        rep.err(f"subject too small/empty: fills {coverage:.0%} of the circle "
                f"(want {MIN_COVERAGE:.0%}-{MAX_COVERAGE:.0%})")
    elif coverage > MAX_COVERAGE:
        rep.err(f"subject too large/bleeding: fills {coverage:.0%} of the circle "
                f"(want {MIN_COVERAGE:.0%}-{MAX_COVERAGE:.0%})")

    if beyond_frac > EDGE_SUBJECT_TOL:
        rep.err(
            f"insect is cropped by the circle: {beyond_frac:.1%} of pixels lie "
            f"outside the safe radius (max reach {max_r_norm:.2f} of circle "
            f"radius; safe <= {SAFE_RADIUS_FRAC:.2f}). Re-generate with the whole "
            f"insect — legs/antennae/wings/tails — inside the inscribed circle."
        )
    elif max_r_norm > SAFE_RADIUS_FRAC:
        rep.warn(f"subject reaches {max_r_norm:.2f} of the circle radius — close to "
                 f"the {SAFE_RADIUS_FRAC:.2f} crop margin; consider more padding")


# ---------------------------------------------------------------------------
# driver
# ---------------------------------------------------------------------------
def select_targets(bugs: list[dict], args) -> list[dict]:
    if args.all:
        return bugs
    if args.slug:
        hit = [b for b in bugs if b.get("slug") == args.slug]
        if not hit:
            sys.exit(f"no bug with slug {args.slug!r} in {BUGS_PATH.name}")
        return hit
    target_date = args.date
    if not target_date:
        target_date = max((b.get("discoveredOn", "") for b in bugs), default="")
    cohort = [b for b in bugs if b.get("discoveredOn") == target_date]
    if not cohort:
        sys.exit(f"no bug with discoveredOn {target_date!r}")
    return cohort


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate Bug Explorer specimens.")
    ap.add_argument("--slug", help="validate a single slug")
    ap.add_argument("--date", help="validate the cohort with this discoveredOn (YYYY-MM-DD)")
    ap.add_argument("--all", action="store_true", help="validate every bug")
    ap.add_argument("--no-image", action="store_true", help="skip image checks")
    ap.add_argument("--frontier", action="store_true",
                    help="also require the validated specimen(s) to be dated at "
                         "the frontier (strictly after the latest existing bug); "
                         "use for the daily-add commit step")
    args = ap.parse_args()

    if args.frontier and args.all:
        sys.exit("--frontier is for new daily specimens, not --all sweeps "
                 "(existing bugs are legitimately not at the frontier)")

    bugs = json.loads(BUGS_PATH.read_text())
    targets = select_targets(bugs, args)

    reports: list[Report] = []
    for bug in targets:
        slug = bug.get("slug", "<no-slug>")
        rep = Report(slug)
        others = [b for b in bugs if b is not bug]
        validate_schema(bug, rep)
        validate_dedup(bug, others, rep)
        if args.frontier:
            validate_frontier(bug, others, rep)
        if not args.no_image:
            validate_image(slug, rep)
        reports.append(rep)

    print(f"Validated {len(reports)} specimen(s) from {BUGS_PATH.name}:\n")
    for rep in reports:
        print(rep.render())

    failed = [r for r in reports if not r.ok]
    print()
    if failed:
        print(f"RESULT: {len(failed)} of {len(reports)} FAILED — do not commit.")
        return 1
    print(f"RESULT: all {len(reports)} passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

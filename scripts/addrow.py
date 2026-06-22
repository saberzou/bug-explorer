#!/usr/bin/env python3
"""
Atomic, validated writer for a single Bug Explorer specimen row.

This is the *only* sanctioned way the daily-add job (or a human) should append a
new bug to ``data/bugs.json``. It replaces the fragile inline-Python the cron
used to run, and it never lets a crash mid-write corrupt the collection.

What it guarantees
------------------
1. **One schema, no drift.** It reuses ``validate_bug``'s schema + dedup +
   frontier checks (imported, not re-implemented). If a row would fail the gate,
   it fails *here* before anything is written — same rules, earlier.
2. **Atomic write.** The new ``bugs.json`` is written to a temp file in the same
   directory and ``os.replace``-d into place, so the 76-row file is never left
   half-written. A timestamped ``.bak`` of the previous file is kept by default.
3. **Idempotent upsert by slug.** Re-running with the same slug updates the row
   in place instead of creating a duplicate. The daily cron can safely retry.
4. **Frontier-safe dates.** With ``--auto-date`` (default on for a *new* slug),
   ``discoveredOn`` is set to ``max(today, latest_in_collection + 1 day)`` so the
   hex grid stays forward-only and never reflows. Pass ``--no-auto-date`` to
   require an explicit date instead.
5. **Sorted, deterministic order.** Rows are kept sorted by
   ``(discoveredOn, slug)`` — the same order ``src/lib/hex.ts`` walks — so the
   file diff is stable and reviewable.
6. **Optional photo manifest.** ``--photos-file`` attaches a Wikimedia-Commons
   photo list into ``data/bug_photos.json`` (also atomic, also upsert-by-slug).

Input (pick one)
----------------
    --json '<inline json object>'
    --json-file path/to/row.json
    (no flag)  -> read the JSON object from stdin

Minimal row (everything else is required by the schema):
    {"commonName": "...", "latinName": "...", "habitat": "...",
     "sizeMm": 30, "sizeKind": "wingspan", "weirdFact": "...",
     "whyItsCool": "...", "rarity": "uncommon"}
``slug`` is derived from ``commonName`` if omitted; ``discoveredOn`` is filled at
the frontier if omitted.

Usage
-----
    # dry-run: validate + show the diff, write nothing (safe to test)
    python3 scripts/addrow.py --json-file row.json --dry-run

    # real add (daily cron): atomic upsert, frontier date, keep a backup
    python3 scripts/addrow.py --json-file row.json

    # attach photos too
    python3 scripts/addrow.py --json-file row.json --photos-file photos.json

    # update an existing row on purpose (e.g. fix a fact), keep its date
    python3 scripts/addrow.py --json-file row.json --no-auto-date

Exit status: 0 on success (or a clean dry-run), non-zero on any validation or
write failure — so the cron can gate on it:
    python3 scripts/addrow.py --json-file row.json && \
        python3 scripts/validate_bug.py --frontier && git commit ...
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import unicodedata
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUGS_PATH = ROOT / "data" / "bugs.json"
PHOTOS_PATH = ROOT / "data" / "bug_photos.json"

# Reuse the gate's logic so there is exactly one source of truth for "valid".
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from validate_bug import (  # type: ignore
        Report,
        validate_schema,
        validate_dedup,
        validate_frontier,
        norm_name,
    )
except Exception as e:  # pragma: no cover - defensive
    sys.exit(f"addrow: could not import validate_bug helpers ({e}); "
             f"run this from the repo's scripts/ alongside validate_bug.py")

# Field order we emit per row — required fields first (README/types.ts order),
# then optional ones, so diffs read top-to-bottom like the schema doc.
ORDER = [
    "slug", "commonName", "latinName", "habitat", "sizeMm", "sizeKind",
    "weirdFact", "whyItsCool", "rarity", "discoveredOn",
    "order", "family", "colorPalette", "photos",
]


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------
def slugify(name: str) -> str:
    """commonName -> kebab-case slug matching the gate's slug rule."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def load_list(path: Path) -> list:
    """Load a JSON array file; tolerate the {'bugs': [...]} wrapper just in case."""
    if not path.exists():
        return []
    data = json.loads(path.read_text())
    if isinstance(data, dict) and isinstance(data.get("bugs"), list):
        return data["bugs"]
    if not isinstance(data, list):
        sys.exit(f"addrow: {path.name} is not a JSON array (got {type(data).__name__})")
    return data


def load_obj(path: Path) -> dict:
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        sys.exit(f"addrow: {path.name} is not a JSON object (got {type(data).__name__})")
    return data


def frontier_date(others: list[dict]) -> str:
    """max(today, latest existing discoveredOn + 1 day), as ISO YYYY-MM-DD."""
    today = date.today()
    dates = []
    for o in others:
        d = o.get("discoveredOn", "")
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d or ""):
            try:
                dates.append(datetime.strptime(d, "%Y-%m-%d").date())
            except ValueError:
                pass
    if not dates:
        return today.isoformat()
    nxt = max(dates) + timedelta(days=1)
    return max(today, nxt).isoformat()


def ordered(bug: dict) -> dict:
    """Return the row with known keys in schema order, unknown keys appended."""
    out = {k: bug[k] for k in ORDER if k in bug}
    for k, v in bug.items():
        if k not in out:
            out[k] = v
    return out


def atomic_write_json(path: Path, payload, *, backup: bool) -> Path | None:
    """Write JSON atomically (temp in same dir + os.replace). Returns backup path
    if one was made. Mirrors the repo's 2-space-indent + trailing-newline style."""
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    bak_path = None
    if backup and path.exists():
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        bak_path = path.with_suffix(path.suffix + f".bak-{stamp}")
        bak_path.write_text(path.read_text())
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)  # atomic on POSIX
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return bak_path


# ---------------------------------------------------------------------------
# core
# ---------------------------------------------------------------------------
def read_input_row(args) -> dict:
    if args.json and args.json_file:
        sys.exit("addrow: pass only one of --json / --json-file")
    raw: str
    if args.json:
        raw = args.json
    elif args.json_file:
        raw = Path(args.json_file).read_text()
    else:
        if sys.stdin.isatty():
            sys.exit("addrow: no row given (use --json, --json-file, or pipe JSON on stdin)")
        raw = sys.stdin.read()
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as e:
        sys.exit(f"addrow: input is not valid JSON: {e}")
    if not isinstance(obj, dict):
        sys.exit(f"addrow: input must be a single JSON object, got {type(obj).__name__}")
    return obj


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Atomically validate + upsert one bug into data/bugs.json.")
    src = ap.add_argument_group("input (choose one; default = stdin)")
    src.add_argument("--json", help="inline JSON object for the row")
    src.add_argument("--json-file", help="path to a JSON file holding the row")

    ap.add_argument("--photos-file",
                    help="path to a JSON array of photo objects to attach for this "
                         "slug in data/bug_photos.json (also atomic + upsert)")
    ap.add_argument("--auto-date", dest="auto_date", action="store_true", default=True,
                    help="fill discoveredOn at the frontier when missing (default)")
    ap.add_argument("--no-auto-date", dest="auto_date", action="store_false",
                    help="require discoveredOn in the input; don't auto-fill")
    ap.add_argument("--no-frontier", action="store_true",
                    help="skip the forward-only frontier check (e.g. backfilling an "
                         "older species on purpose). Dedup + schema still enforced.")
    ap.add_argument("--allow-update", action="store_true",
                    help="permit upserting an EXISTING slug (update in place). Without "
                         "this, hitting an existing slug is an error to avoid clobbering.")
    ap.add_argument("--no-backup", action="store_true",
                    help="don't keep a timestamped .bak of the previous file")
    ap.add_argument("--dry-run", action="store_true",
                    help="validate and show what would change; write nothing")
    args = ap.parse_args()

    bug = read_input_row(args)

    # --- derive slug / date before validation ------------------------------
    if not bug.get("slug"):
        common = bug.get("commonName", "")
        if not common:
            sys.exit("addrow: row needs at least a commonName (to derive slug) or an explicit slug")
        bug["slug"] = slugify(common)

    bugs = load_list(BUGS_PATH)
    existing_idx = next((i for i, b in enumerate(bugs) if b.get("slug") == bug["slug"]), None)
    is_update = existing_idx is not None

    if is_update and not args.allow_update:
        sys.exit(
            f"addrow: slug {bug['slug']!r} already exists at index {existing_idx} "
            f"({bugs[existing_idx].get('commonName')!r}). Refusing to overwrite. "
            f"Pass --allow-update to update it in place (idempotent re-add), or "
            f"choose a new slug."
        )

    # 'others' = the collection minus the row we're adding/replacing.
    others = [b for i, b in enumerate(bugs) if i != existing_idx]

    if not bug.get("discoveredOn"):
        if args.auto_date:
            bug["discoveredOn"] = frontier_date(others)
        else:
            sys.exit("addrow: discoveredOn missing and --no-auto-date set; "
                     "provide an explicit YYYY-MM-DD date")

    bug = ordered(bug)

    # --- validate with the gate's own logic --------------------------------
    rep = Report(bug["slug"])
    validate_schema(bug, rep)
    validate_dedup(bug, others, rep)
    if not args.no_frontier and not is_update:
        # Frontier only applies to a genuinely new, forward-dated specimen.
        validate_frontier(bug, others, rep)

    print(rep.render())
    if not rep.ok:
        print("\naddrow: validation FAILED — nothing written.", file=sys.stderr)
        return 1

    # --- attach photos (optional) ------------------------------------------
    photos_payload = None
    if args.photos_file:
        photos = json.loads(Path(args.photos_file).read_text())
        if not isinstance(photos, list):
            sys.exit("addrow: --photos-file must contain a JSON array of photo objects")
        photos_map = load_obj(PHOTOS_PATH)
        photos_map[bug["slug"]] = photos
        photos_payload = photos_map
        # Mirror a lightweight presence flag onto the row (the site reads the
        # manifest separately, but keeping the row honest helps debugging).
        if photos:
            bug["photos"] = photos
            bug = ordered(bug)

    # --- compute the new list (sorted, deterministic) ----------------------
    new_bugs = list(others) + [bug]
    new_bugs.sort(key=lambda b: (b.get("discoveredOn", ""), b.get("slug", "")))

    verb = "UPDATE" if is_update else "ADD"
    print(
        f"\n{verb}  {bug['slug']}  ({bug.get('commonName')})  "
        f"discoveredOn={bug.get('discoveredOn')}  rarity={bug.get('rarity')}"
    )
    print(f"      collection: {len(bugs)} -> {len(new_bugs)} bug(s)")
    if photos_payload is not None:
        print(f"      photos: {len(photos_payload.get(bug['slug'], []))} attached for {bug['slug']}")

    if args.dry_run:
        print("\n[dry-run] no files written.")
        return 0

    bak = atomic_write_json(BUGS_PATH, new_bugs, backup=not args.no_backup)
    print(f"\nwrote {BUGS_PATH.relative_to(ROOT)} ({len(new_bugs)} bugs)"
          + (f"  [backup: {bak.name}]" if bak else ""))
    if photos_payload is not None:
        pbak = atomic_write_json(PHOTOS_PATH, photos_payload, backup=not args.no_backup)
        print(f"wrote {PHOTOS_PATH.relative_to(ROOT)} ({len(photos_payload)} slugs)"
              + (f"  [backup: {pbak.name}]" if pbak else ""))

    print("\nnext: drop public/bugs/%s.png, then run "
          "`python3 scripts/validate_bug.py --frontier` before committing." % bug["slug"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

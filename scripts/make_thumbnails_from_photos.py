#!/usr/bin/env python3
"""
Create 1024x1024 PNG thumbnails for the spiral grid from existing photo gallery
images. Used as a fallback when image_generate is unavailable (e.g. network DNS
rewrite issues).

For each slug that has photos in public/bugs/photos/<slug>/ but no
public/bugs/<slug>.png, take photo 1, center-crop to square, resize to 1024x1024,
and save as <slug>.png.

These look photographic rather than illustrated (the existing 30 use AI
illustrations). Treat as a stopgap until image_generate works again.

Usage:
    python3 scripts/make_thumbnails_from_photos.py            # all missing
    python3 scripts/make_thumbnails_from_photos.py <slug>...  # specific slugs
    python3 scripts/make_thumbnails_from_photos.py --force    # overwrite all
"""
import json
import sys
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
BUGS_PATH = ROOT / "data" / "bugs.json"
PHOTOS_DIR = ROOT / "public" / "bugs" / "photos"
THUMBS_DIR = ROOT / "public" / "bugs"
TARGET_SIZE = 1024


def square_crop_resize(src_path: Path, dst_path: Path):
    """Open src image, center-crop to square, resize to TARGET_SIZE, save as PNG."""
    with Image.open(src_path) as img:
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")
        w, h = img.size
        # Center-crop to square
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        img = img.crop((left, top, left + side, top + side))
        # Resize to TARGET_SIZE
        img = img.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)
        img.save(dst_path, "PNG", optimize=True)


def main():
    args = sys.argv[1:]
    force = "--force" in args
    targets = [a for a in args if a != "--force"]

    bugs = json.loads(BUGS_PATH.read_text())
    all_slugs = [b["slug"] for b in bugs]

    if targets:
        slugs = [s for s in targets if s in all_slugs]
        unknown = set(targets) - set(slugs)
        if unknown:
            print(f"⚠️  Unknown slugs (skipped): {sorted(unknown)}")
    else:
        # All slugs that have photos but no thumbnail
        slugs = []
        for slug in all_slugs:
            thumb = THUMBS_DIR / f"{slug}.png"
            photo = PHOTOS_DIR / slug / "1.jpg"
            if photo.exists() and (force or not thumb.exists()):
                slugs.append(slug)

    print(f"Generating {len(slugs)} thumbnails (force={force})")

    success = 0
    fail = 0
    for slug in slugs:
        photo = PHOTOS_DIR / slug / "1.jpg"
        thumb = THUMBS_DIR / f"{slug}.png"
        if not photo.exists():
            print(f"  ✗ {slug}: no source photo at {photo.relative_to(ROOT)}")
            fail += 1
            continue
        try:
            square_crop_resize(photo, thumb)
            print(f"  ✓ {slug}: {thumb.relative_to(ROOT)}")
            success += 1
        except Exception as exc:
            print(f"  ✗ {slug}: {type(exc).__name__}: {exc}")
            fail += 1

    print(f"\nDone: {success} created, {fail} failed")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Fetch 2 photos per bug from Wikimedia Commons categories."""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUGS_PATH = ROOT / "data" / "bugs.json"
OUT_DIR = ROOT / "public" / "bugs" / "photos"
META_PATH = ROOT / "data" / "bug_photos.json"

USER_AGENT = (
    "BugExplorer/1.0 (https://github.com/saberzou/bug-explorer; "
    "axel-bot@openclaw) Python"
)

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
PHOTO_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
SKIP_TOKENS = (
    "icon", "audio", "sound", "map", "distribution", "range",
    "diagram", "drawing", "illustration", "engraving", "lithograph",
    "phylogen", "taxonomic", "taxonomy", "cladogram", "stamp",
    "logo", "wikispecies", "commons-logo",
)


def http_get_json(url, params):
    full = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(full, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_get_bytes(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def list_category_files(category, limit=300):
    files = []
    cmcontinue = None
    while True:
        params = {
            "action": "query",
            "list": "categorymembers",
            "cmtitle": f"Category:{category}",
            "cmtype": "file",
            "cmlimit": "200",
            "format": "json",
        }
        if cmcontinue:
            params["cmcontinue"] = cmcontinue
        data = http_get_json(COMMONS_API, params)
        for m in data.get("query", {}).get("categorymembers", []):
            t = m.get("title")
            if t:
                files.append(t)
            if len(files) >= limit:
                return files
        nxt = data.get("continue", {}).get("cmcontinue")
        if not nxt:
            break
        cmcontinue = nxt
        time.sleep(0.2)
    return files


def category_exists(category):
    data = http_get_json(
        COMMONS_API,
        {"action": "query", "titles": f"Category:{category}", "format": "json"},
    )
    pages = data.get("query", {}).get("pages", {})
    for p in pages.values():
        if "missing" in p:
            return False
        if p.get("title", "").lower() == f"category:{category}".lower():
            return True
    return False


def commons_image_info(file_title):
    data = http_get_json(
        COMMONS_API,
        {
            "action": "query",
            "titles": file_title,
            "prop": "imageinfo",
            "iiprop": "url|extmetadata|mime|size",
            "iiurlwidth": "1200",
            "format": "json",
        },
    )
    pages = data.get("query", {}).get("pages", {})
    for p in pages.values():
        info_list = p.get("imageinfo", [])
        if not info_list:
            continue
        return info_list[0]
    return None


def is_photo_candidate(file_title, info):
    title_lower = file_title.lower()
    if any(tok in title_lower for tok in SKIP_TOKENS):
        return False
    mime = (info.get("mime") or "").lower()
    if "svg" in mime:
        return False
    if mime and not mime.startswith("image/"):
        return False
    ext = os.path.splitext(file_title)[1].lower()
    if ext not in PHOTO_EXTS:
        return False
    width = info.get("width", 0) or 0
    height = info.get("height", 0) or 0
    if width and width < 640:
        return False
    if height and height < 480:
        return False
    return True


def cheap_filename_score(file_title, latin, genus):
    name = file_title.lower()
    if any(tok in name for tok in SKIP_TOKENS):
        return -1
    ext = os.path.splitext(file_title)[1].lower()
    if ext not in PHOTO_EXTS:
        return -1
    latin_low = latin.lower()
    genus_low = genus.lower()
    if latin_low in name:
        return 100
    if genus_low in name:
        return 40
    return -1


def score_photo(file_title, latin, genus, info):
    name = file_title.lower()
    latin_low = latin.lower()
    genus_low = genus.lower()
    if latin_low in name:
        s = 100
    elif genus_low in name:
        s = 40
    else:
        return -1
    width = info.get("width", 0) or 0
    s += min(width // 200, 25)
    return s


def extract_meta(info, file_title):
    ext = info.get("extmetadata", {}) or {}
    artist_html = (ext.get("Artist") or {}).get("value", "")
    license_short = (ext.get("LicenseShortName") or {}).get("value", "")
    license_url = (ext.get("LicenseUrl") or {}).get("value", "")
    credit_html = (ext.get("Credit") or {}).get("value", "")
    description = (ext.get("ImageDescription") or {}).get("value", "")

    def strip(s):
        s = re.sub(r"<[^>]+>", "", s or "")
        s = s.replace("&amp;", "&").replace("&nbsp;", " ").strip()
        return " ".join(s.split())

    return {
        "src": info.get("thumburl") or info.get("url"),
        "originalUrl": info.get("url"),
        "descriptionUrl": info.get("descriptionurl")
            or f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(file_title)}",
        "credit": strip(artist_html) or strip(credit_html) or "Wikimedia Commons",
        "license": strip(license_short) or "see Commons page",
        "licenseUrl": license_url,
        "caption": strip(description)[:280],
        "fileTitle": file_title,
        "width": info.get("width"),
        "height": info.get("height"),
    }


def gather_candidate_files(latin, genus):
    seen = set()
    out = []
    for cat in (latin, genus):
        if not cat:
            continue
        try:
            if not category_exists(cat):
                continue
            files = list_category_files(cat, limit=300)
        except Exception as exc:
            print(f"   ! category lookup failed for {cat}: {exc}")
            continue
        for f in files:
            if f not in seen:
                out.append(f)
                seen.add(f)
        time.sleep(0.2)
    return out


def pick_photos_for_bug(bug, want=2, max_probes=14):
    latin = bug["latinName"]
    genus = latin.split()[0]
    files = gather_candidate_files(latin, genus)
    if not files:
        print(f"   ! no Commons categories found for {latin}")
        return []
    pre = []
    for f in files:
        s = cheap_filename_score(f, latin, genus)
        if s > 0:
            pre.append((s, f))
    pre.sort(key=lambda x: x[0], reverse=True)
    pre = pre[:max_probes]

    scored = []
    for _s, f in pre:
        info = commons_image_info(f)
        time.sleep(0.1)
        if not info or not is_photo_candidate(f, info):
            continue
        s = score_photo(f, latin, genus, info)
        if s < 0:
            continue
        scored.append((s, f, info))
        if len(scored) >= want * 3:
            break

    scored.sort(key=lambda x: x[0], reverse=True)
    return [extract_meta(info, f) for (_s, f, info) in scored[:want]]


def main():
    bugs = json.loads(BUGS_PATH.read_text())
    print(f"Loaded {len(bugs)} bugs.")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    existing = {}
    if META_PATH.exists():
        try:
            existing = json.loads(META_PATH.read_text())
        except json.JSONDecodeError:
            existing = {}
    result = dict(existing)

    args = sys.argv[1:]
    force = False
    if "--force" in args:
        force = True
        args.remove("--force")
    only = set(args)

    missing = []
    for i, bug in enumerate(bugs, 1):
        slug = bug["slug"]
        if only and slug not in only:
            continue
        if not force and slug in result and len(result[slug]) >= 2:
            still_present = all(
                (ROOT / "public" / p["localPath"].lstrip("/")).exists()
                for p in result[slug] if "localPath" in p
            )
            if still_present:
                print(f"[{i:02}/{len(bugs)}] {slug}: have {len(result[slug])}, skip")
                continue
            print(f"[{i:02}/{len(bugs)}] {slug}: metadata stale, refetching")
        print(f"[{i:02}/{len(bugs)}] {slug} ({bug['latinName']})")
        try:
            picks = pick_photos_for_bug(bug, want=2)
        except Exception as exc:
            print(f"  !! error: {exc}")
            missing.append(slug)
            continue
        if not picks:
            print(f"  -- no photos found for {slug}")
            missing.append(slug)
            continue

        bug_dir = OUT_DIR / slug
        bug_dir.mkdir(parents=True, exist_ok=True)
        stored = []
        for idx, meta in enumerate(picks, 1):
            url = meta["src"]
            try:
                data = http_get_bytes(url)
            except Exception as exc:
                print(f"  !! download failed for {url}: {exc}")
                continue
            out_path = bug_dir / f"{idx}.jpg"
            out_path.write_bytes(data)
            meta["localPath"] = f"/bugs/photos/{slug}/{idx}.jpg"
            stored.append(meta)
            print(f"   * {idx}: {meta['fileTitle'][:64]} ({meta['license']}, by {meta['credit'][:40]})")
            time.sleep(0.3)
        if stored:
            result[slug] = stored
        else:
            missing.append(slug)
        META_PATH.write_text(json.dumps(result, indent=2, ensure_ascii=False))

    if missing:
        print(f"\nMissing photos for {len(missing)} bugs:")
        for s in missing:
            print(f"  - {s}")
    print(f"\nDone. Metadata at {META_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

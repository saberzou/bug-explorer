import { promises as fs } from "node:fs";
import path from "node:path";
import type { Bug, BugPhoto } from "./types";

const DATA_PATH = path.join(process.cwd(), "data", "bugs.json");
const PHOTOS_PATH = path.join(process.cwd(), "data", "bug_photos.json");

let cache: Bug[] | null = null;

/**
 * Raw entry shape in data/bug_photos.json (written by scripts/fetch_bug_photos.py).
 * `localPath` is the file on disk under /public; we map it onto BugPhoto.src so
 * the UI gets a stable local URL. `descriptionUrl` is the Commons page; we expose
 * it as BugPhoto.sourceUrl so the gallery can render a "source" link.
 */
interface RawPhotoEntry {
  localPath: string;
  credit: string;
  license: string;
  licenseUrl?: string;
  descriptionUrl?: string;
  caption?: string;
}

async function loadPhotoMap(): Promise<Record<string, BugPhoto[]>> {
  let raw: string;
  try {
    raw = await fs.readFile(PHOTOS_PATH, "utf-8");
  } catch {
    return {};
  }
  const parsed = JSON.parse(raw) as Record<string, RawPhotoEntry[]>;
  const out: Record<string, BugPhoto[]> = {};
  for (const [slug, entries] of Object.entries(parsed)) {
    if (!Array.isArray(entries)) continue;
    const mapped: BugPhoto[] = entries
      .filter((e) => typeof e?.localPath === "string" && e.localPath.length > 0)
      .map((e) => ({
        src: e.localPath,
        credit: e.credit || "Wikimedia Commons",
        license: e.license || "see source",
        licenseUrl: e.licenseUrl || undefined,
        sourceUrl: e.descriptionUrl || undefined,
        caption: e.caption || undefined,
      }));
    if (mapped.length > 0) {
      out[slug] = mapped;
    }
  }
  return out;
}

/** Load every bug entry from disk. Cached at module level for the build. */
export async function loadBugs(): Promise<Bug[]> {
  if (cache) return cache;
  const [rawBugs, photoMap] = await Promise.all([
    fs.readFile(DATA_PATH, "utf-8"),
    loadPhotoMap(),
  ]);
  const parsed = JSON.parse(rawBugs) as Bug[];
  const merged = parsed.map((b) => {
    // Prefer photos already embedded in bugs.json (the curated source of truth).
    // Fall back to the fetcher's bug_photos.json scratch file only when a slug
    // has no inline photos yet, so Atticus / Saber can hand-edit bugs.json
    // without the loader silently clobbering their picks.
    if (Array.isArray(b.photos) && b.photos.length > 0) {
      return b;
    }
    const photos = photoMap[b.slug];
    return photos && photos.length > 0 ? { ...b, photos } : b;
  });
  cache = merged.sort((a, b) => a.slug.localeCompare(b.slug));
  return cache;
}

/** Find one bug by slug, or null if not present. */
export async function getBug(slug: string): Promise<Bug | null> {
  const bugs = await loadBugs();
  return bugs.find((b) => b.slug === slug) ?? null;
}

/** Return the slug + image path that the cron should use for a given bug. */
export function imageHref(slug: string): string {
  return `/bugs/${slug}.png`;
}

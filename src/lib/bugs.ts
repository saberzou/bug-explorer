import { promises as fs } from "node:fs";
import path from "node:path";
import type { Bug } from "./types";

const DATA_PATH = path.join(process.cwd(), "data", "bugs.json");

let cache: Bug[] | null = null;

/** Load every bug entry from disk. Cached at module level for the build. */
export async function loadBugs(): Promise<Bug[]> {
  if (cache) return cache;
  const raw = await fs.readFile(DATA_PATH, "utf-8");
  const parsed = JSON.parse(raw) as Bug[];
  cache = parsed.sort((a, b) => a.slug.localeCompare(b.slug));
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

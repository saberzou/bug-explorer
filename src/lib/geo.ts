import { promises as fs } from "node:fs";
import path from "node:path";

export type RangeKind = "point" | "regional" | "cosmopolitan";

export interface BugGeo {
  lat: number;
  lng: number;
  region: string;
  rangeKind: RangeKind;
}

/**
 * Habitat phrase → representative location. Ported from scripts/backfill_geo.py
 * and kept as the SINGLE runtime source of truth so that any new bug added to
 * data/bugs.json automatically gets a globe pin — no separate backfill step.
 * First match wins, so the most specific phrases come first.
 */
const RULES: ReadonlyArray<[RegExp, number, number, string, RangeKind]> = [
  [/papua new guinea|oro province/, -6.5, 147.0, "Papua New Guinea", "point"],
  [/new guinea|indonesian islands/, -5.5, 141.0, "New Guinea", "regional"],
  [/new zealand/, -41.5, 172.5, "New Zealand", "point"],
  [/madagasc/, -19.0, 46.7, "Madagascar", "point"],
  [/andes|peru|bolivia|ecuador/, -12.0, -75.5, "The Andes", "regional"],
  [/brazil|atlantic rainforest/, -14.0, -51.0, "Brazil", "regional"],
  [/amazon/, -4.0, -62.0, "Amazon Basin", "regional"],
  [/central america/, 12.5, -85.0, "Central America", "regional"],
  [
    /neotropic|central & south america|central and south america|south america/,
    -6.0, -60.0, "Central & South America", "regional",
  ],
  [/southeast asia/, 4.5, 110.0, "Southeast Asia", "regional"],
  [/central asia/, 45.0, 68.0, "Central Asia", "regional"],
  [/japan|china|east asia|korea/, 34.0, 112.0, "East Asia", "regional"],
  [/sub-saharan|tropical africa/, 1.0, 21.0, "Sub-Saharan Africa", "regional"],
  [/southern africa/, -25.0, 25.0, "Southern Africa", "regional"],
  [
    /southeastern north america|southeast(ern)? (united states|us)/,
    32.5, -83.5, "SE North America", "regional",
  ],
  [
    /eastern north america|eastern (united states|us|u\.s\.)/,
    40.0, -80.0, "Eastern North America", "regional",
  ],
  [/western north america/, 41.0, -114.0, "Western North America", "regional"],
  [/north america/, 39.0, -98.0, "North America", "regional"],
  [/alpine|high-altitude/, 46.5, 10.5, "Alpine Europe", "regional"],
  [/europe/, 50.0, 10.0, "Europe", "regional"],
  [/australia/, -28.0, 140.0, "Australia", "regional"],
  [/\basia\b/, 30.0, 95.0, "Asia", "regional"],
  [/africa/, 3.0, 20.0, "Africa", "regional"],
  [/eurasia/, 50.0, 60.0, "Eurasia", "regional"],
  [/holarctic|northern hemisphere/, 48.0, 20.0, "Northern Hemisphere", "regional"],
  [/worldwide|cosmopolitan|domesticated|global/, 20.0, 15.0, "Worldwide", "cosmopolitan"],
  [/tropic/, 0.0, 12.0, "Tropics", "regional"],
];

/** Stable FNV-1a hash → deterministic per-slug jitter so co-located pins spread. */
function jitter(slug: string): [number, number] {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h >>>= 0;
  const a = (h & 0xffff) / 0xffff;
  const b = ((h >>> 16) & 0xffff) / 0xffff;
  return [(a - 0.5) * 7.0, (b - 0.5) * 9.0];
}

/** Resolve a bug's globe location from its habitat text (+ deterministic jitter). */
export function resolveGeo(slug: string, habitat: string): BugGeo {
  const h = habitat.toLowerCase();
  let lat = 0;
  let lng = 0;
  let region = "Unknown";
  let kind: RangeKind = "regional";
  for (const [re, rlat, rlng, rregion, rkind] of RULES) {
    if (re.test(h)) {
      lat = rlat;
      lng = rlng;
      region = rregion;
      kind = rkind;
      break;
    }
  }
  const [dlat, dlng] = jitter(slug);
  return {
    lat: +(lat + dlat).toFixed(3),
    lng: +(lng + dlng).toFixed(3),
    region,
    rangeKind: kind,
  };
}

/**
 * Optional hand-tuned coordinate overrides (data/geo_overrides.json, keyed by
 * slug). Absent by default — the resolver covers everything. Use it only to
 * pin a precise endemic location that the habitat text can't express.
 */
let overrides: Record<string, Partial<BugGeo>> | null = null;
export async function loadGeoOverrides(): Promise<Record<string, Partial<BugGeo>>> {
  if (overrides) return overrides;
  try {
    const p = path.join(process.cwd(), "data", "geo_overrides.json");
    overrides = JSON.parse(await fs.readFile(p, "utf-8"));
  } catch {
    overrides = {};
  }
  return overrides ?? {};
}

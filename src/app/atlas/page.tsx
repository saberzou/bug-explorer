import type { Metadata } from "next";
import AtlasView from "@/components/AtlasView";
import type { AtlasPin } from "@/components/AtlasGlobe";
import { loadBugs } from "@/lib/bugs";
import { loadGeoOverrides, resolveGeo } from "@/lib/geo";

export const metadata: Metadata = {
  title: "Atlas — Bug Explorer",
  description: "A field globe of where each specimen is found.",
};

export default async function AtlasPage() {
  const [bugs, overrides] = await Promise.all([loadBugs(), loadGeoOverrides()]);

  // Resolve a location for EVERY bug from its habitat (so new daily specimens
  // appear automatically), letting an optional override refine precise spots.
  const pins: AtlasPin[] = bugs.map((b) => {
    const geo = { ...resolveGeo(b.slug, b.habitat), ...overrides[b.slug] };
    return {
      slug: b.slug,
      commonName: b.commonName,
      rarity: b.rarity,
      lat: geo.lat,
      lng: geo.lng,
      region: geo.region,
      rangeKind: geo.rangeKind,
    };
  });

  return <AtlasView pins={pins} count={bugs.length} />;
}

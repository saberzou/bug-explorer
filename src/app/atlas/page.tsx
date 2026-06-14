import type { Metadata } from "next";
import AtlasView from "@/components/AtlasView";
import type { AtlasPin } from "@/components/AtlasGlobe";
import { loadBugs } from "@/lib/bugs";
import { loadBugGeo } from "@/lib/geo";

export const metadata: Metadata = {
  title: "Atlas — Bug Explorer",
  description: "A field globe of where each specimen is found.",
};

export default async function AtlasPage() {
  const [bugs, geo] = await Promise.all([loadBugs(), loadBugGeo()]);
  const pins: AtlasPin[] = bugs
    .filter((b) => geo[b.slug])
    .map((b) => ({
      slug: b.slug,
      commonName: b.commonName,
      rarity: b.rarity,
      ...geo[b.slug],
    }));

  return <AtlasView pins={pins} count={bugs.length} />;
}

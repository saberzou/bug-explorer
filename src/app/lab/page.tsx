import type { Metadata } from "next";
import LabView from "@/components/LabView";
import type { LabBug } from "@/components/LabView";
import { loadBugs } from "@/lib/bugs";

export const metadata: Metadata = {
  title: "Breeding Lab — Bug Explorer",
  description: "Cross two specimens and let the lab dream up a brand-new hybrid.",
};

export default async function LabPage() {
  const bugs = await loadBugs();
  const list: LabBug[] = bugs
    .map((b) => ({ slug: b.slug, commonName: b.commonName, rarity: b.rarity }))
    .sort((a, b) => a.commonName.localeCompare(b.commonName));
  return <LabView bugs={list} />;
}

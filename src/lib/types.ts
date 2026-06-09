// Bug Explorer schema — see README for distribution conventions.
export type Rarity = "common" | "uncommon" | "rare" | "legendary";

export interface Bug {
  /** URL slug, e.g. "atlas-moth". Stable forever — drives hex coords. */
  slug: string;
  /** English common name, e.g. "Atlas Moth". */
  commonName: string;
  /** Binomial Latin name, e.g. "Attacus atlas". */
  latinName: string;
  /** Habitat, short phrase. e.g. "Southeast Asian rainforests". */
  habitat: string;
  /** Body or wingspan size in millimeters (largest dimension). */
  sizeMm: number;
  /** One weird-but-true fact, ≤ 140 chars ideal. */
  weirdFact: string;
  /** Why this bug earns a spot — voice, opinion. */
  whyItsCool: string;
  /** ISO date (YYYY-MM-DD) when added to the grid. */
  discoveredOn: string;
  /** Visual rarity tier. */
  rarity: Rarity;
}

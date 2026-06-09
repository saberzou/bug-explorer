// Bug Explorer schema — see SCHEMA.md (and README) for full guidance.
export type Rarity = "common" | "uncommon" | "rare" | "legendary";

export type SizeKind = "body" | "wingspan";

export interface Bug {
  /** URL slug, e.g. "atlas-moth". STABLE FOREVER — drives URL + image + hex coords. */
  slug: string;
  /** English common name, e.g. "Atlas Moth". */
  commonName: string;
  /** Binomial Latin name, e.g. "Attacus atlas". Rendered italic in the UI. */
  latinName: string;
  /** Habitat, short phrase: region + biome. */
  habitat: string;
  /** Iconic dimension in mm (wingspan for moths/butterflies, body length for everything else). */
  sizeMm: number;
  /** Which dimension `sizeMm` represents — lets the UI label correctly. */
  sizeKind: SizeKind;
  /** One weird-but-true fact, encyclopedia tone. Ideal ≤ 140 chars. */
  weirdFact: string;
  /** Why this bug earns a circle. Voice, opinion, perspective. Ideal ≤ 160 chars. */
  whyItsCool: string;
  /** Visual rarity tier — drives ring color, glow, and grid texture. */
  rarity: Rarity;
  /** ISO date (YYYY-MM-DD) when added to the grid. Latest gets the pulsing ring. */
  discoveredOn: string;

  /** Optional. Taxonomic order, e.g. "Lepidoptera". */
  order?: string;
  /** Optional. Family, e.g. "Nymphalidae". */
  family?: string;
  /** Optional. 3 hex codes; drives ambient hover glow under the circle. */
  colorPalette?: [string, string, string];
  /** Optional. Real photos sourced from Wikimedia Commons, with attribution. */
  photos?: BugPhoto[];
}

export interface BugPhoto {
  /** Local URL under /bugs/photos/<slug>/<n>.jpg. */
  src: string;
  /** Human-readable attribution (artist / uploader). */
  credit: string;
  /** Short license code, e.g. "CC BY-SA 4.0". */
  license: string;
  /** Permanent URL to the license text. */
  licenseUrl?: string;
  /** Commons file description page; used for the "source" link. */
  sourceUrl?: string;
  /** Optional caption from Commons file description. */
  caption?: string;
}

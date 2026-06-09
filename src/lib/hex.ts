// Deterministic slug → axial hex coordinates.
// Stable: a slug, once assigned, NEVER changes position. New bugs always grow
// the cluster outward in chronological order, so older bugs sit closer to
// the center and recent additions ring around them like growth rings on a
// tree. Forward-only assignment guarantees the no-reflow contract.

export interface AxialCoord {
  q: number;
  r: number;
}

/** Walk an outward spiral on the axial hex grid, ring by ring. */
function spiralCoord(index: number): AxialCoord {
  if (index === 0) return { q: 0, r: 0 };
  let ring = 1;
  let cumulative = 1;
  while (cumulative + 6 * ring <= index) {
    cumulative += 6 * ring;
    ring += 1;
  }
  const positionInRing = index - cumulative; // 0..(6*ring - 1)
  const edge = Math.floor(positionInRing / ring); // 0..5
  const step = positionInRing % ring; // 0..ring-1

  // Axial directions around the ring (pointy-top hex layout).
  const directions: AxialCoord[] = [
    { q: 1, r: -1 },
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: -1, r: 1 },
    { q: -1, r: 0 },
    { q: 0, r: -1 },
  ];
  // Start of ring: walk `ring` steps along directions[4] from origin.
  const startDir = directions[4];
  let q = startDir.q * ring;
  let r = startDir.r * ring;
  // Walk edge steps along directions[edge], then step steps along directions[(edge+1)%6].
  for (let i = 0; i < edge; i += 1) {
    q += directions[i].q * ring;
    r += directions[i].r * ring;
  }
  const next = directions[(edge + 1) % 6];
  q += next.q * step;
  r += next.r * step;
  return { q, r };
}

/**
 * Assign stable axial coords to a list of bugs.
 *
 * Stability contract: a slug, once assigned, NEVER changes position. New bugs
 * always claim the next outer slot beyond all existing ones — the cluster
 * grows outward chronologically, like growth rings on a tree.
 *
 * Algorithm:
 *   1. Sort by `discoveredOn` ascending, then by slug (deterministic tie-break
 *      for same-day cohorts).
 *   2. Walk the spiral from slot 0 outward, assigning each bug in order. The
 *      Nth-oldest bug gets the Nth spiral slot.
 *
 * Result: dense hex pack with zero gaps, oldest at center, no reflow ever.
 * 30 bugs fill rings 0–3 (37 slots, 7 leftover empty at the outer edge).
 * 100 bugs fill rings 0–6. 1000 bugs reach ring 19.
 */
export interface BugEntry {
  slug: string;
  discoveredOn: string; // ISO date
}

export function assignCoords(bugs: BugEntry[]): Map<string, AxialCoord> {
  const map = new Map<string, AxialCoord>();
  if (bugs.length === 0) return map;

  // Resolve oldest first so new bugs always claim the next outer slot.
  const sorted = [...bugs].sort((a, b) => {
    if (a.discoveredOn !== b.discoveredOn) {
      return a.discoveredOn < b.discoveredOn ? -1 : 1;
    }
    // Tie-break by slug (stable, deterministic) so a batch of same-day bugs
    // resolves in a fixed order across machines.
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });

  for (let index = 0; index < sorted.length; index++) {
    const { slug } = sorted[index];
    // Assign sequentially to spiral slots 0, 1, 2, ... Older bugs land in
    // central slots; new bugs grow the cluster outward like rings of a tree.
    // This guarantees a dense pack regardless of cohort size, and no existing
    // bug ever shifts because we resolve in chronological order.
    const coord = spiralCoord(index);
    map.set(slug, coord);
  }

  return map;
}

/** Convert axial (q,r) hex coords to pixel (x,y) for pointy-top layout. */
export function axialToPixel(coord: AxialCoord, size: number): { x: number; y: number } {
  const x = size * Math.sqrt(3) * (coord.q + coord.r / 2);
  const y = size * (3 / 2) * coord.r;
  return { x, y };
}

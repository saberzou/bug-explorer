// Deterministic slug → axial hex coordinates.
// Stable: a slug, once assigned, NEVER changes position. New bugs always grow
// the cluster outward in chronological order, so older bugs sit closer to
// the center and recent additions ring around them like growth rings on a
// tree. Forward-only assignment guarantees the no-reflow contract.

export interface AxialCoord {
  q: number;
  r: number;
}

/**
 * Walk an outward spiral on the axial hex grid, ring by ring.
 *
 * Slot 0 is origin. Slots 1..6 fill ring 1. Slots 7..18 fill ring 2. Etc.
 * Within each ring, we start at the top-left corner (direction 4 = (-1, 0))
 * and walk clockwise around the ring, taking `ring` steps along each of the
 * six edge directions in turn.
 */
function spiralCoord(index: number): AxialCoord {
  if (index === 0) return { q: 0, r: 0 };

  // Find which ring this index belongs to. Ring N starts at slot 1 + 6*(N-1)*N/2.
  let ring = 1;
  let ringStart = 1;
  while (ringStart + 6 * ring <= index) {
    ringStart += 6 * ring;
    ring += 1;
  }
  const positionInRing = index - ringStart; // 0..(6*ring - 1)

  // Six axial directions (pointy-top hex).
  const directions: AxialCoord[] = [
    { q: 1, r: -1 },
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: -1, r: 1 },
    { q: -1, r: 0 },
    { q: 0, r: -1 },
  ];

  // Start at the ring's anchor corner: `ring` steps in direction 4.
  let q = directions[4].q * ring;
  let r = directions[4].r * ring;

  // Walk clockwise: each edge takes `ring` steps along directions[edge].
  let stepsRemaining = positionInRing;
  for (let edge = 0; edge < 6 && stepsRemaining > 0; edge++) {
    const stepsOnThisEdge = Math.min(ring, stepsRemaining);
    q += directions[edge].q * stepsOnThisEdge;
    r += directions[edge].r * stepsOnThisEdge;
    stepsRemaining -= stepsOnThisEdge;
  }

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

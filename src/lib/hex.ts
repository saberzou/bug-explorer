// Deterministic slug → axial hex coordinates.
// Recency-centered: the NEWEST bug sits at the center slot and older bugs ring
// outward by discovery date, so a visitor always lands on the most recent
// addition in the middle of the cluster. Adding a newer bug re-centers the
// cluster (existing bugs shift outward by one ring) — this reflow is intentional
// and is what keeps "something new" in the center on every visit.

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
 * Stability contract: the cluster is re-centered on the NEWEST bug. Each time
 * a newer bug is added it takes the center slot and the rest spiral outward by
 * recency, so the most recent discoveries are always near the middle where
 * visitors look first. (Positions therefore reflow when a newer bug arrives —
 * this is intentional: newest-at-center is the whole point.)
 *
 * Algorithm:
 *   1. Compute each bug's EFFECTIVE sort date = min(discoveredOn, today).
 *      Future-dated bugs (the daily-add pipeline pre-stamps specimens days
 *      ahead) are clamped to today so they can't outrank the genuinely-newest
 *      already-released bug. The real latest bug therefore holds the center.
 *   2. Sort by effective date descending (newest first). Tie-break first by
 *      ACTUAL discoveredOn ascending — so among today's clamped cohort the
 *      soonest-upcoming bug sits nearest the center and each future bug rotates
 *      inward as its date arrives — then by slug (deterministic, machine-stable).
 *   3. Walk the spiral from slot 0 outward, assigning each bug in order. The
 *      Nth-newest bug gets the Nth spiral slot.
 *
 * Note: the build is static, so "today" is frozen at build time; the daily-add
 * cron rebuilds/redeploys each day, which refreshes it. Pass an explicit
 * `today` in tests for determinism.
 *
 * Result: dense hex pack with zero gaps, newest at center, older bugs ringed
 * outward by recency.
 * 30 bugs fill rings 0–3 (37 slots, 7 leftover empty at the outer edge).
 * 100 bugs fill rings 0–6. 1000 bugs reach ring 19.
 */
export interface BugEntry {
  slug: string;
  discoveredOn: string; // ISO date
}

export function assignCoords(
  bugs: BugEntry[],
  today: string = new Date().toISOString().slice(0, 10),
): Map<string, AxialCoord> {
  const map = new Map<string, AxialCoord>();
  if (bugs.length === 0) return map;

  // Effective date clamps future-dated bugs to today so a specimen "discovered"
  // two weeks out can't sit in the center ahead of the real latest release.
  const effective = (d: string) => (d > today ? today : d);

  // Newest-effective first claims the center slot. Future cohort (all clamped
  // to today) is ordered by true date ascending so the soonest one is nearest
  // center and rotates inward as its day arrives; slug breaks remaining ties.
  const sorted = [...bugs].sort((a, b) => {
    const ea = effective(a.discoveredOn);
    const eb = effective(b.discoveredOn);
    if (ea !== eb) return ea > eb ? -1 : 1;
    if (a.discoveredOn !== b.discoveredOn) {
      return a.discoveredOn < b.discoveredOn ? -1 : 1;
    }
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });

  for (let index = 0; index < sorted.length; index++) {
    const { slug } = sorted[index];
    // Assign sequentially to spiral slots 0, 1, 2, ... Newest bug lands in the
    // center slot; older bugs ring outward by recency. Adding a newer bug
    // re-centers the cluster (positions reflow), which is the intended
    // "always show something new in the middle" behavior.
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

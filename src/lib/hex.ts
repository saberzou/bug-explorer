// Deterministic slug → axial hex coordinates.
// Stable: a slug always maps to the same (q, r) — never reflows when new bugs land.
// We use a fast 32-bit string hash (FNV-1a) and Halton-like spiral packing,
// then verify uniqueness against an occupied set so collisions resolve gracefully.

export interface AxialCoord {
  q: number;
  r: number;
}

/** FNV-1a 32-bit hash, deterministic across machines. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
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
 * always claim the next free slot beyond all existing ones. This is the
 * "discovery cabinet" invariant — once a bug is in the wild it stays put.
 *
 * Algorithm:
 *   1. Sort bugs by `discoveredOn` ascending, then by slug for tie-breaks.
 *      Oldest bug resolves first → claims its hash-determined slot.
 *   2. For each bug in chronological order, pick a starting spiral slot from
 *      its hash (`% 61` packs the first ~30 bugs into rings 0–4 = a tight
 *      cluster visible without panning).
 *   3. If the slot is occupied by an older bug, probe forward (slot+1, +2 …)
 *      until free. Forward-only probing + chronological resolution means
 *      older slots are never reassigned.
 *
 * Tradeoff: a new bug that hashes to an occupied region just walks outward
 * to the next empty slot. Over time the cluster grows organically outward,
 * preserving every historical position.
 */
export interface BugEntry {
  slug: string;
  discoveredOn: string; // ISO date
}

export function assignCoords(bugs: BugEntry[]): Map<string, AxialCoord> {
  const map = new Map<string, AxialCoord>();
  if (bugs.length === 0) return map;

  // Resolve oldest first so new bugs can never bump older ones out of a slot.
  const sorted = [...bugs].sort((a, b) => {
    if (a.discoveredOn !== b.discoveredOn) {
      return a.discoveredOn < b.discoveredOn ? -1 : 1;
    }
    // Tie-break by slug (stable, deterministic) so a batch of same-day bugs
    // resolves in a fixed order across machines.
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  const occupied = new Set<string>();

  for (const { slug } of sorted) {
    let probe = fnv1a(slug) % 61;
    let coord = spiralCoord(probe);
    let key = `${coord.q},${coord.r}`;
    while (occupied.has(key)) {
      probe += 1;
      coord = spiralCoord(probe);
      key = `${coord.q},${coord.r}`;
    }
    occupied.add(key);
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

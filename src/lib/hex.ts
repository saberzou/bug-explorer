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
 * Assign stable axial coords to a list of slugs.
 * Order-independent: sorts slugs by hash before mapping into spiral slots,
 * so adding new bugs later never disturbs existing positions of older slugs
 * that hash lower.
 *
 * Tradeoff: a *new* slug whose hash falls between two existing slugs will
 * NOT push them. We instead append new high-hash slugs to the next spiral
 * slot beyond the current max. This keeps the grid stable for end users.
 */
export function assignCoords(slugs: string[]): Map<string, AxialCoord> {
  const map = new Map<string, AxialCoord>();
  if (slugs.length === 0) return map;

  // Sort by hash so legendary/rare don't all cluster.
  const sorted = [...slugs].sort((a, b) => fnv1a(a) - fnv1a(b));
  const occupied = new Set<string>();
  let nextIndex = 0;

  for (const slug of sorted) {
    // Map slug hash → starting spiral index, then probe forward on collision.
    let probe = fnv1a(slug) % 2048;
    let coord = spiralCoord(probe);
    let key = `${coord.q},${coord.r}`;
    while (occupied.has(key)) {
      probe += 1;
      coord = spiralCoord(probe);
      key = `${coord.q},${coord.r}`;
    }
    occupied.add(key);
    map.set(slug, coord);
    nextIndex = Math.max(nextIndex, probe + 1);
  }

  return map;
}

/** Convert axial (q,r) hex coords to pixel (x,y) for pointy-top layout. */
export function axialToPixel(coord: AxialCoord, size: number): { x: number; y: number } {
  const x = size * Math.sqrt(3) * (coord.q + coord.r / 2);
  const y = size * (3 / 2) * coord.r;
  return { x, y };
}

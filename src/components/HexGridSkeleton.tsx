/**
 * Loading placeholder for the home page hex grid.
 *
 * Renders a handful of grey circles in a hex arrangement around the viewport
 * center, animated with Tailwind's animate-pulse. No JS dependency — server
 * component friendly. Used by `app/loading.tsx` while bugs.json + first
 * render are streaming.
 */
const PLACEHOLDER_COUNT = 19; // matches a 3-ring hex cluster (1 + 6 + 12)

// Axial-coord ring layout for a 3-ring hex cluster, scaled to roughly match
// the live grid's HEX_SIZE 66 / BUG_SIZE 132 rhythm.
const RING_OFFSETS: Array<{ x: number; y: number }> = (() => {
  const HEX_SIZE = 66;
  const SQRT3 = Math.sqrt(3);
  const out: Array<{ x: number; y: number }> = [];
  // Center.
  out.push({ x: 0, y: 0 });
  // Ring 1 (6 cells) and ring 2 (12 cells).
  const rings: Array<Array<{ q: number; r: number }>> = [];
  for (let ring = 1; ring <= 2; ring++) {
    const cells: Array<{ q: number; r: number }> = [];
    let q = 0;
    let r = -ring;
    const dirs = [
      [1, 0],
      [1, -1],
      [0, -1],
      [-1, 0],
      [-1, 1],
      [0, 1],
    ];
    for (let side = 0; side < 6; side++) {
      for (let step = 0; step < ring; step++) {
        cells.push({ q, r });
        q += dirs[side][0];
        r += dirs[side][1];
      }
    }
    rings.push(cells);
  }
  for (const cells of rings) {
    for (const { q, r } of cells) {
      const x = HEX_SIZE * SQRT3 * (q + r / 2);
      const y = HEX_SIZE * 1.5 * r * 1.15; // mirror live grid's 1.15 stretch
      out.push({ x, y });
    }
  }
  return out;
})();

export default function HexGridSkeleton() {
  const BUG_SIZE = 132;
  return (
    <div
      aria-hidden="true"
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ width: 0, height: 0 }}
    >
      {RING_OFFSETS.slice(0, PLACEHOLDER_COUNT).map((p, i) => (
        <div
          key={i}
          className="absolute animate-pulse rounded-full bg-zinc-800/70 ring-1 ring-zinc-700/40"
          style={{
            width: BUG_SIZE,
            height: BUG_SIZE,
            left: p.x - BUG_SIZE / 2,
            top: p.y - BUG_SIZE / 2,
            animationDelay: `${(i % 6) * 80}ms`,
            // Subtle radial scale falloff so the cluster echoes the fisheye.
            transform: `scale(${1 - Math.min(0.45, Math.hypot(p.x, p.y) / 900)})`,
          }}
        />
      ))}
    </div>
  );
}

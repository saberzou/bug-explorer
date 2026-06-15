"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import BugImage from "@/components/BugImage";
import { assignCoords } from "@/lib/hex";
import { prefersReducedMotion, setBugOrigin, storeHandoff } from "@/lib/transition";
import type { Bug, Rarity } from "@/lib/types";

interface BugGridProps {
  bugs: Bug[];
  /** Slug of the bug discovered most recently — gets the "new" treatment. */
  latestSlug: string | null;
}

// Rarity rim treatment on the grid circles. Drawn with Tailwind `ring`
// utilities (outset box-shadow) so the rim sits just outside the clipped
// circle and is never cut by the image's `overflow-hidden`.
//
//  - common    → no rim (the quiet majority of the grid)
//  - uncommon  → thin gold rim
//  - rare      → cool sky-blue rim, so it reads distinctly from the golds
//  - legendary → bolder gold rim + a soft gold glow, the apex treatment
//
// Gold (amber) intentionally spans uncommon + legendary; legendary earns the
// extra weight and halo so it still reads as the top tier at a glance.
const RARITY_RING: Record<Rarity, string> = {
  common: "",
  uncommon: "ring-1 ring-amber-300/70",
  rare: "ring-1 ring-sky-300/70",
  legendary:
    "ring-2 ring-amber-300 shadow-[0_0_14px_3px_rgba(251,191,36,0.45)]",
};

// Canvas dimensions are computed at runtime based on the viewport.
// HEX_SIZE is the axial-coord scaling factor. With the standard pointy-top
// formula, adjacent cells along the q-axis are sqrt(3)*HEX_SIZE pixels apart,
// and adjacent rows are 1.5*HEX_SIZE pixels apart. BUG_SIZE is the pixel
// diameter of each bug circle at full scale; intentionally close to (and
// slightly less than) the hex spacing so circles nearly kiss for a dense
// cluster look. The outer rings happily extend beyond the viewport — users
// drag to roam, exactly like the Apple Watch home screen.
const HEX_SIZE = 66;
const BUG_SIZE = 132;

// Pre-computed sqrt(3) and PI/2 for inner loop speed.
const SQRT3 = Math.sqrt(3);
const HALF_PI = Math.PI / 2;

// Easing curves mirroring Modoki's behavior.
function easeInOutSine(t: number) {
  return -0.5 * (Math.cos(Math.PI * t) - 1);
}
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function easeInSine(t: number) {
  return 1 - Math.cos((t * Math.PI) / 2);
}
function easeOutSine(t: number) {
  return Math.sin((t * Math.PI) / 2);
}
/** Tweenable-style interpolation. */
function interp(
  ease: (t: number) => number,
  current: number,
  base: number,
  change: number,
  duration: number,
) {
  return change * ease(current / duration) + base;
}

/** Cartesian → polar. */
function toPolar(x: number, y: number) {
  return {
    radius: Math.sqrt(x * x + y * y),
    radian: Math.atan2(y, x),
  };
}

/** Polar → cartesian. */
function toCartesian(radius: number, radian: number) {
  return {
    x: radius * Math.cos(radian),
    y: radius * Math.sin(radian),
  };
}

/**
 * Modoki-style refresh. Given a desired pan offset, compute each bug's
 * (x, y, scale) so that:
 *  - bugs near the cluster center stay at full size, in their natural hex slot;
 *  - bugs near the canvas edge shrink toward 0.2 and get gently nudged inward;
 *  - the radial spacing curves outward like a fisheye lens, so the cluster
 *    feels like beads on a balloon.
 *
 * `baseCells` are the pre-computed (q, r) → (x, y) hex positions, centered at
 * (0, 0). `offset` is the current pan in pixels.
 */
function modokiTransform(
  baseCells: { baseX: number; baseY: number }[],
  offset: { x: number; y: number },
  canvasW: number,
  canvasH: number,
  curveRadius = 320,
) {
  const items: { x: number; y: number; scale: number }[] = [];
  const halfW = canvasW / 2;
  const halfH = canvasH / 2;
  const cellPad = 32; // edge buffer; bugs inside this margin shrink

  for (let i = 0; i < baseCells.length; i++) {
    const baseX = baseCells[i].baseX + offset.x;
    const baseY = baseCells[i].baseY + offset.y;
    const polar = toPolar(baseX, baseY);

    // Radial fisheye: cells close to center get pulled outward (slight
    // bubble), cells far get compressed (asymptote to natural radius).
    const m = polar.radius / curveRadius;
    let curvedRadius: number;
    let depth: number;
    if (m < 1) {
      // Inside the curve: expand slightly, depth from full → mid.
      curvedRadius =
        polar.radius * interp(easeInOutSine, m / 1, 1.5, -0.5, 1);
      depth = interp(easeInOutCubic, m / 1, 1, -0.5, 1);
    } else {
      // Beyond the curve radius: stay at natural radius, depth bottoms out.
      curvedRadius = polar.radius;
      depth = interp(easeInOutCubic, 1, 1, -0.5, 1);
    }

    const pos = toCartesian(curvedRadius, polar.radian);

    // Slight vertical stretch to echo Apple Watch screen aspect.
    pos.y = pos.y * 1.15;

    // Scale falloff near canvas edges.
    let scale: number;
    const absX = Math.abs(pos.x);
    const absY = Math.abs(pos.y);
    if (absX > halfW - cellPad || absY > halfH - cellPad) {
      // Bug is mostly past the visible region: shrink to 20% of depth.
      scale = depth * 0.2;
    } else if (
      absX > halfW - 2 * cellPad &&
      absY > halfH - 2 * cellPad
    ) {
      // Corner zone: shrink along the steeper axis.
      scale = Math.min(
        depth *
          interp(easeInOutSine, halfW - absX - cellPad, 0.4, 0.6, cellPad),
        depth *
          interp(easeInOutSine, halfH - absY - cellPad, 0.3, 0.7, cellPad),
      );
    } else if (absX > halfW - 2 * cellPad) {
      // Right/left edge band.
      scale =
        depth *
        interp(easeOutSine, halfW - absX - cellPad, 0.4, 0.6, cellPad);
    } else if (absY > halfH - 2 * cellPad) {
      // Top/bottom edge band.
      scale =
        depth *
        interp(easeOutSine, halfH - absY - cellPad, 0.4, 0.6, cellPad);
    } else {
      // Interior: full depth.
      scale = depth;
    }

    // Soft push-in near edges so bugs don't fly off the canvas.
    if (pos.x < -halfW + 2 * cellPad) {
      pos.x += interp(easeInSine, halfW - absX - 2 * cellPad, 0, 6, 2 * cellPad);
    } else if (pos.x > halfW - 2 * cellPad) {
      pos.x += interp(easeInSine, halfW - absX - 2 * cellPad, 0, -6, 2 * cellPad);
    }
    if (pos.y < -halfH + 2 * cellPad) {
      pos.y += interp(easeInSine, halfH - absY - 2 * cellPad, 0, 8, 2 * cellPad);
    } else if (pos.y > halfH - 2 * cellPad) {
      pos.y += interp(easeInSine, halfH - absY - 2 * cellPad, 0, -8, 2 * cellPad);
    }

    items.push({ x: pos.x, y: pos.y, scale });
  }

  return items;
}

export default function BugGrid({ bugs }: BugGridProps) {
  // Cluster canvas sized responsively: bigger on desktop, fits phone screens.
  const [canvasSize, setCanvasSize] = useState({ w: 380, h: 420 });

  useEffect(() => {
    const update = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Take the full viewport so the cluster naturally extends past the
      // visible area. Users drag to roam toward the edges, fisheye reveals
      // them — same as Apple Watch.
      setCanvasSize({ w: vw, h: vh });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Pre-compute hex base positions for each bug (deterministic, never reflows).
  const positioned = useMemo(() => {
    const coords = assignCoords(
      bugs.map((b) => ({ slug: b.slug, discoveredOn: b.discoveredOn })),
    );
    return bugs.map((bug) => {
      const coord = coords.get(bug.slug) ?? { q: 0, r: 0 };
      // Pointy-top hex layout, slightly compressed Y to match Modoki rhythm.
      // Pointy-top axial → pixel (standard hex math).
      const baseX = HEX_SIZE * SQRT3 * (coord.q + coord.r / 2);
      const baseY = HEX_SIZE * 1.5 * coord.r;
      return { bug, baseX, baseY };
    });
  }, [bugs]);

  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Pan target (set by pointer events); render position lerps toward target.
  const targetOffset = useRef({ x: 0, y: 0 });
  const renderOffset = useRef({ x: 0, y: 0 });
  const dragState = useRef({
    dragging: false,
    pointerStartX: 0,
    pointerStartY: 0,
    offsetStartX: 0,
    offsetStartY: 0,
    movedSquared: 0,
  });

  // Initial mount: snap render position once so first paint is correct.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Lets pointer handlers (and resize/data effects) wake the RAF loop after
  // it has parked itself. Stable identity; the live implementation is swapped
  // in by the effect below so it always closes over the current layout inputs.
  const ensureRunning = useRef<() => void>(() => {});

  // requestAnimationFrame loop: lerp render → target, then layout items.
  //
  // The loop is NOT a perpetual 60fps spinner. It parks itself (stops
  // scheduling frames) once the render offset has converged on the target and
  // no drag is in flight — there's nothing left to animate when the cluster is
  // settled, so burning a frame every 16ms just drains battery/CPU. Pointer
  // activity (and layout-input changes) call ensureRunning() to wake it again.
  useEffect(() => {
    let raf = 0;
    let running = false;

    // Pre-compute the viewport zoom once per loop activation; it only depends
    // on canvasSize, which is fixed for the lifetime of this effect.
    const zoom = Math.min(
      1.55,
      Math.max(1.0, 1.0 + (canvasSize.w - 900) / 1273),
    );

    // Reused scratch buffer so we don't allocate 65 objects every frame.
    const baseCells = positioned.map((p) => ({
      baseX: p.baseX,
      baseY: p.baseY,
    }));

    const tick = () => {
      const dx = targetOffset.current.x - renderOffset.current.x;
      const dy = targetOffset.current.y - renderOffset.current.y;
      // Settled = caught up to the target AND the user isn't actively dragging.
      // Sub-pixel threshold so we don't park mid-motion or chase float noise.
      const settled =
        !dragState.current.dragging &&
        Math.abs(dx) < 0.1 &&
        Math.abs(dy) < 0.1;

      if (settled) {
        // Snap to exact target for a crisp final frame, then park.
        renderOffset.current.x = targetOffset.current.x;
        renderOffset.current.y = targetOffset.current.y;
      } else {
        // Smooth inertia: render position eases toward target at 12%/frame.
        renderOffset.current.x += dx * 0.12;
        renderOffset.current.y += dy * 0.12;
      }

      const layout = modokiTransform(
        baseCells,
        renderOffset.current,
        canvasSize.w,
        canvasSize.h,
      );

      // Write directly to DOM (avoid React re-render every frame).
      for (let i = 0; i < layout.length; i++) {
        const el = itemRefs.current[i];
        if (!el) continue;
        const { x, y, scale } = layout[i];
        el.style.transform = `translate(${x * zoom}px, ${y * zoom}px) scale(${scale * zoom})`;
      }

      if (settled) {
        // Nothing left to animate — stop scheduling frames until woken.
        running = false;
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(tick);
    };
    ensureRunning.current = start;

    // Kick once on mount / whenever layout inputs change so the cluster paints
    // its initial (or re-measured) position, then parks on the next frame.
    start();

    return () => {
      cancelAnimationFrame(raf);
      running = false;
      ensureRunning.current = () => {};
    };
  }, [positioned, canvasSize]);

  // Pointer handlers — drag updates the TARGET offset; RAF loop animates.
  //
  // IMPORTANT: do NOT call setPointerCapture on the parent canvas in
  // onPointerDown. Pointer capture for a MOUSE pointer also retargets
  // mouseup and the synthesized click event to the capture target. With
  // capture on the parent, click never reaches the Link child and
  // navigation silently fails on desktop. The parent canvas covers the
  // full viewport (canvasSize = viewport size), so the pointer naturally
  // stays "inside" during a drag without explicit capture.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragState.current = {
      dragging: true,
      pointerStartX: e.clientX,
      pointerStartY: e.clientY,
      offsetStartX: targetOffset.current.x,
      offsetStartY: targetOffset.current.y,
      movedSquared: 0,
    };
    // Wake the RAF loop if it has parked since the last interaction.
    ensureRunning.current();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.dragging) return;
    const dx = e.clientX - dragState.current.pointerStartX;
    const dy = e.clientY - dragState.current.pointerStartY;
    targetOffset.current.x = dragState.current.offsetStartX + dx;
    targetOffset.current.y = dragState.current.offsetStartY + dy;

    // Bound the offset so the user can't fling the cluster into the void.
    const maxX = canvasSize.w * 1.3;
    const maxY = canvasSize.h * 1.3;
    targetOffset.current.x = Math.max(-maxX, Math.min(maxX, targetOffset.current.x));
    targetOffset.current.y = Math.max(-maxY, Math.min(maxY, targetOffset.current.y));

    // Total squared distance from pointer-start. Use ASSIGNMENT, not
    // accumulation: dx/dy are already start→now deltas, so accumulating
    // them on every pointermove inflates movedSquared into the drag-threshold
    // range from natural mouse jitter during a click (bug seen on desktop:
    // a 4-5 px hand-tremor click registered as a drag and preventDefault'd
    // the Link navigation). Single-frame assignment is the correct math.
    dragState.current.movedSquared = dx * dx + dy * dy;
  };

  const onPointerUp = (_e: React.PointerEvent<HTMLDivElement>) => {
    dragState.current.dragging = false;
  };

  // Suppress link click after a non-trivial drag.
  const wasDrag = () => dragState.current.movedSquared > 25;

  return (
    <div className="relative h-full w-full overflow-hidden touch-none select-none">
      {/* Cluster canvas, centered in viewport. */}
      <div
        className="absolute left-1/2 top-1/2 cursor-grab active:cursor-grabbing"
        style={{
          width: canvasSize.w,
          height: canvasSize.h,
          marginLeft: -canvasSize.w / 2,
          marginTop: -canvasSize.h / 2,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {positioned.map(({ bug }, i) => (
          <div
            key={bug.slug}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            className="absolute"
            style={{
              left: "50%",
              top: "50%",
              width: BUG_SIZE,
              height: BUG_SIZE,
              marginLeft: -BUG_SIZE / 2,
              marginTop: -BUG_SIZE / 2,
              transform: mounted ? undefined : "scale(0)",
              willChange: "transform",
              transformOrigin: "center center",
            }}
          >
            <Link
              href={`/bug/${bug.slug}`}
              aria-label={`${bug.commonName}, ${bug.rarity}`}
              className={`group relative block h-full w-full rounded-full bg-zinc-900 ${RARITY_RING[bug.rarity]} overflow-hidden`}
              style={
                bug.colorPalette
                  ? ({
                      backgroundColor: bug.colorPalette[0],
                    } as React.CSSProperties)
                  : undefined
              }
              onClick={(ev) => {
                if (wasDrag()) {
                  ev.preventDefault();
                  return;
                }
                setBugOrigin("/");
                // Stash the source rect for GSAP FLIP into the detail page.
                if (!prefersReducedMotion()) {
                  const rect = (
                    ev.currentTarget as HTMLAnchorElement
                  ).getBoundingClientRect();
                  storeHandoff({
                    slug: bug.slug,
                    rect: {
                      x: rect.x,
                      y: rect.y,
                      w: rect.width,
                      h: rect.height,
                    },
                    bg: bug.colorPalette?.[0],
                    ts: Date.now(),
                  });
                }
              }}
              draggable={false}
            >
              <BugImage
                src={`/bugs/${bug.slug}.png`}
                alt={bug.commonName}
                className="h-full w-full object-cover pointer-events-none"
                fallbackText={bug.commonName}
              />
              {/* Saber: removed latest-bug pulse halo per design feedback */}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

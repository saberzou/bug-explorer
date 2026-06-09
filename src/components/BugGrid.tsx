"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import BugImage from "@/components/BugImage";
import { assignCoords } from "@/lib/hex";
import type { Bug, Rarity } from "@/lib/types";

interface BugGridProps {
  bugs: Bug[];
  /** Slug of the bug discovered most recently — gets the "new" treatment. */
  latestSlug: string | null;
}

const RARITY_RING: Record<Rarity, string> = {
  common: "ring-1 ring-zinc-700/50",
  uncommon: "ring-2 ring-emerald-500/60",
  rare: "ring-2 ring-sky-400/70 shadow-[0_0_22px_rgba(56,189,248,0.35)]",
  legendary:
    "ring-2 ring-amber-300/85 shadow-[0_0_30px_rgba(252,211,77,0.55)]",
};

// Canvas dimensions are computed at runtime based on the viewport.
// HEX_SIZE is the axial-coord scaling factor. With the standard pointy-top
// formula, adjacent cells along the q-axis are sqrt(3)*HEX_SIZE pixels apart,
// and adjacent rows are 1.5*HEX_SIZE pixels apart. BUG_SIZE should be a
// touch less than the smaller spacing so circles can sit nicely without
// overlapping at full scale.
const HEX_SIZE = 54;
const BUG_SIZE = 78;

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
  curveRadius = 220,
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

export default function BugGrid({ bugs, latestSlug }: BugGridProps) {
  // Cluster canvas sized responsively: bigger on desktop, fits phone screens.
  const [canvasSize, setCanvasSize] = useState({ w: 380, h: 420 });

  useEffect(() => {
    const update = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Take ~90% of viewport, capped so the cluster doesn't get absurd on
      // huge screens. Keep aspect close to Modoki's 9:10 phone-y feel.
      const w = Math.min(820, Math.floor(vw * 0.9));
      const h = Math.min(900, Math.floor(vh * 0.9));
      setCanvasSize({ w, h });
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

  // requestAnimationFrame loop: lerp render → target, then layout items.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      // Smooth inertia: render position eases toward target at 12% per frame.
      renderOffset.current.x +=
        (targetOffset.current.x - renderOffset.current.x) * 0.12;
      renderOffset.current.y +=
        (targetOffset.current.y - renderOffset.current.y) * 0.12;

      const baseCells = positioned.map((p) => ({
        baseX: p.baseX,
        baseY: p.baseY,
      }));
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
        el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [positioned, canvasSize]);

  // Pointer handlers — drag updates the TARGET offset; RAF loop animates.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragState.current = {
      dragging: true,
      pointerStartX: e.clientX,
      pointerStartY: e.clientY,
      offsetStartX: targetOffset.current.x,
      offsetStartY: targetOffset.current.y,
      movedSquared: 0,
    };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
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

    dragState.current.movedSquared += dx * dx + dy * dy;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragState.current.dragging = false;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
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
                if (wasDrag()) ev.preventDefault();
              }}
              draggable={false}
            >
              <BugImage
                src={`/bugs/${bug.slug}.png`}
                alt={bug.commonName}
                className="h-full w-full object-cover pointer-events-none"
                fallbackText={bug.commonName.slice(0, 2)}
              />
              {bug.slug === latestSlug && (
                <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-amber-200 animate-pulse" />
              )}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

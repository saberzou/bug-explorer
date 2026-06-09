"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import BugImage from "@/components/BugImage";
import { assignCoords, axialToPixel } from "@/lib/hex";
import type { Bug, Rarity } from "@/lib/types";

interface BugGridProps {
  bugs: Bug[];
  /** Slug of the bug discovered most recently — gets the "new" treatment. */
  latestSlug: string | null;
}

const RARITY_RING: Record<Rarity, string> = {
  common: "ring-1 ring-zinc-700/40",
  uncommon: "ring-2 ring-emerald-500/50",
  rare: "ring-2 ring-sky-400/60 shadow-[0_0_20px_rgba(56,189,248,0.35)]",
  legendary:
    "ring-2 ring-amber-300/80 shadow-[0_0_28px_rgba(252,211,77,0.55)]",
};

const HEX_SIZE = 64; // hex circumradius in px — circle diameter is ~1.5x this

export default function BugGrid({ bugs, latestSlug }: BugGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panState = useRef({
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  const positioned = useMemo(() => {
    const coords = assignCoords(
      bugs.map((b) => ({ slug: b.slug, discoveredOn: b.discoveredOn })),
    );
    return bugs.map((bug) => {
      const coord = coords.get(bug.slug) ?? { q: 0, r: 0 };
      const pixel = axialToPixel(coord, HEX_SIZE);
      return { bug, ...pixel };
    });
  }, [bugs]);

  // Center the grid on first mount, accounting for viewport size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setOffset({
      x: el.clientWidth / 2,
      y: el.clientHeight / 2,
    });
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    setIsPanning(true);
    panState.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanning) return;
    const dx = event.clientX - panState.current.startX;
    const dy = event.clientY - panState.current.startY;
    setOffset({
      x: panState.current.originX + dx,
      y: panState.current.originY + dy,
    });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    setIsPanning(false);
    (event.target as Element).releasePointerCapture?.(event.pointerId);
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden touch-none select-none cursor-grab data-[panning=true]:cursor-grabbing"
      data-panning={isPanning}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        ref={surfaceRef}
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          transition: isPanning ? "none" : "transform 240ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        <AnimatePresence>
          {positioned.map(({ bug, x, y }) => (
            <motion.div
              key={bug.slug}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                type: "spring",
                stiffness: 220,
                damping: 22,
                delay: Math.random() * 0.4,
              }}
              className="absolute"
              style={{
                left: x,
                top: y,
                width: HEX_SIZE * 1.6,
                height: HEX_SIZE * 1.6,
                marginLeft: -(HEX_SIZE * 0.8),
                marginTop: -(HEX_SIZE * 0.8),
              }}
            >
            <Link
                href={`/bug/${bug.slug}`}
                aria-label={`${bug.commonName}, ${bug.rarity}`}
                className={`group relative block h-full w-full rounded-full bg-zinc-900 ${RARITY_RING[bug.rarity]} transition-transform duration-200 hover:scale-110 active:scale-95 overflow-hidden`}
                style={
                  bug.colorPalette
                    ? ({
                        // Subtle ambient backdrop tinted by the bug's palette.
                        backgroundColor: bug.colorPalette[0],
                      } as React.CSSProperties)
                    : undefined
                }
                onClick={(e) => {
                  if (isPanning) e.preventDefault();
                }}
              >
                {/* Bug image, falls back to a quiet placeholder while content is pending. */}
                <BugImage
                  src={`/bugs/${bug.slug}.png`}
                  alt={bug.commonName}
                  className="h-full w-full object-cover"
                  fallbackText={bug.commonName.slice(0, 2)}
                />
                {bug.slug === latestSlug && (
                  <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-amber-200 animate-pulse" />
                )}
              </Link>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

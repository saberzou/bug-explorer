"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import gsap from "gsap";
import BugImage from "@/components/BugImage";
import {
  clearHandoff,
  prefersReducedMotion,
  readHandoff,
  storeHandoff,
} from "@/lib/transition";

interface BugDetailHeroProps {
  slug: string;
  commonName: string;
  fallbackBg?: string;
}

/**
 * Circular hero illustration on the bug detail page. Wrapped as a client
 * component so it can:
 *
 *   1. Pick up the GSAP handoff sessionStorage payload written by BugGrid
 *      and FLIP-tween itself from the clicked grid position into its
 *      natural layout slot.
 *   2. Trigger the reverse transition when the user clicks the "back to
 *      grid" link — the hero shrinks back toward its origin rect and the
 *      surrounding content fades, then we router.push("/").
 *
 * If no handoff is present (deep link, refresh, reduced motion), the hero
 * simply renders in place.
 */
export default function BugDetailHero({
  slug,
  commonName,
  fallbackBg,
}: BugDetailHeroProps) {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  // useLayoutEffect runs synchronously after DOM commit but before browser
  // paint. We use it for the FLIP path so the hero is snapped to its source
  // rect BEFORE the first paint — the user never sees the hero at its
  // destination position before the morph starts.
  //
  // For reduced-motion and plain-mount paths, we do nothing: the hero is
  // already rendered at opacity:1 in its laid-out position, no flash.
  useLayoutEffect(() => {
    const node = heroRef.current;
    if (!node) return;
    if (prefersReducedMotion()) return;

    const handoff = readHandoff(slug);
    if (!handoff) return;

    // FLIP-with-handoff path: snap hero to source rect synchronously (pre-paint),
    // then tween back to laid-out position.
    const target = node.getBoundingClientRect();
    const srcCx = handoff.rect.x + handoff.rect.w / 2;
    const srcCy = handoff.rect.y + handoff.rect.h / 2;
    const dstCx = target.x + target.width / 2;
    const dstCy = target.y + target.height / 2;
    const dx = srcCx - dstCx;
    const dy = srcCy - dstCy;
    const scale = handoff.rect.w / target.width;

    gsap.set(node, {
      x: dx,
      y: dy,
      scale,
      transformOrigin: "center center",
    });

    // Per Axel: easeInOutCubic (power3.inOut) matches the modoki grid's
    // depth curve and avoids the jolt-at-start that comes from morphing
    // FROM a bug that's itself in fisheye motion.
    const tl = gsap.timeline({
      defaults: { ease: "power3.inOut" },
      onComplete: () => {
        clearHandoff();
      },
    });
    tl.to(node, {
      x: 0,
      y: 0,
      scale: 1,
      duration: 0.5, // Axel spec: 450-550ms
    });

    return () => {
      tl.kill();
    };
  }, [slug]);

  const handleBack = (ev: React.MouseEvent<HTMLAnchorElement>) => {
    if (prefersReducedMotion()) return;
    const node = heroRef.current;
    if (!node) return;
    // We don't have the original grid rect any more — but we can stash the
    // current hero rect so the home grid can fade-in around it. The reverse
    // animation just shrinks + fades the hero, then navigates.
    ev.preventDefault();
    const rect = node.getBoundingClientRect();
    storeHandoff({
      slug,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      bg: fallbackBg,
      ts: Date.now(),
    });

    // Reverse direction: bug returns to the grid (which is also in motion).
    // Symmetric inOut ease keeps continuity with the same depth curve as the
    // forward transition.
    gsap.to(node, {
      scale: 0.4,
      autoAlpha: 0,
      duration: 0.45,
      ease: "power3.inOut",
    });
    gsap.to("[data-detail-fade]", {
      autoAlpha: 0,
      y: 12,
      duration: 0.35,
      ease: "power3.inOut",
      stagger: 0.04,
      onComplete: () => router.push("/"),
    });
  };

  return (
    <>
      {/* Hidden helper that exposes the back handler to the sibling Link.
          We render the link in the parent (server component) and listen for
          a click event via a portal-less custom-event channel. Simpler: we
          accept that the link is part of this client wrapper. */}
      <div
        ref={heroRef}
        className="aspect-square w-full max-w-xs flex-none overflow-hidden rounded-full bg-zinc-900 ring-1 ring-zinc-700/50"
        style={{
          backgroundColor: fallbackBg,
        }}
      >
        <BugImage
          src={`/bugs/${slug}.png`}
          alt={commonName}
          className="h-full w-full object-cover"
          fallbackText="image pending"
        />
      </div>
      {/* Mounting our handler globally via a data attribute the back link can
          dispatch into. The back-link in the parent server component carries
          data-bug-back, and we wire it up via the effect below. */}
      <BackLinkBridge onBack={handleBack} />
    </>
  );
}

/**
 * Wires any `<a data-bug-back>` element into our reverse-transition handler.
 * Lets the server-component parent keep the visible Link markup while this
 * client wrapper handles the GSAP interception.
 */
function BackLinkBridge({
  onBack,
}: {
  onBack: (ev: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  useEffect(() => {
    const link = document.querySelector<HTMLAnchorElement>("[data-bug-back]");
    if (!link) return;
    const handler = (ev: MouseEvent) => {
      // Synthesise a React-ish event object for the handler.
      onBack({
        preventDefault: () => ev.preventDefault(),
        currentTarget: link,
      } as unknown as React.MouseEvent<HTMLAnchorElement>);
    };
    link.addEventListener("click", handler);
    return () => link.removeEventListener("click", handler);
  }, [onBack]);
  return null;
}

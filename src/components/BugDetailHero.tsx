"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  // Per Axel QA: default visible. The reduced-motion path and the
  // plain-mount (no-handoff) path both should show the hero immediately
  // on first paint. Only the FLIP-with-handoff path needs to start hidden
  // so we can position before revealing — and in that path, we synchronously
  // flip to false in useLayoutEffect (below) before the browser paints.
  const [ready, setReady] = useState(true);

  // useLayoutEffect runs synchronously after DOM mutation but before browser
  // paint, so we can detect the FLIP-with-handoff case and hide the hero
  // BEFORE the browser commits the first frame. For reduced-motion and
  // plain-mount, we never hide it — first paint shows the hero immediately,
  // no flash. SSR-safe: useLayoutEffect doesn't run on server, and the
  // useState(true) default means SSR markup renders visible too.
  useLayoutEffect(() => {
    const node = heroRef.current;
    if (!node) return;

    if (prefersReducedMotion()) {
      // Already visible from useState(true). Nothing else to do.
      return;
    }

    const handoff = readHandoff(slug);

    if (!handoff) {
      // Plain mount path (deep link, refresh): hero is already visible from
      // initial render (useState(true)). No GSAP fade — a fade here would
      // first hide the hero (autoAlpha:0) and then fade in, which produces
      // exactly the blank-circle flash Axel measured. The hero just appears.
      return;
    }

    // FLIP-with-handoff path: hide the hero immediately so the snap-to-source
    // rect doesn't cause a positioning flash. setReady(false) here is fine
    // because GSAP's gsap.set() below will paint the hero at the source
    // rect within the same frame; the autoAlpha:1 makes it visible from
    // that snapped position.
    setReady(false);

    // FLIP: snap the hero from its laid-out rect to the source rect, then
    // tween back to the laid-out position.
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
      autoAlpha: 1,
    });

    // Per Axel: easeInOutCubic (power3.inOut) matches the modoki grid's
    // depth curve and avoids the jolt-at-start that comes from morphing
    // FROM a bug that's itself in fisheye motion.
    const tl = gsap.timeline({
      defaults: { ease: "power3.inOut" },
      onComplete: () => {
        clearHandoff();
        setReady(true);
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
          // Start invisible; the effect above tweens autoAlpha to 1. This
          // prevents a flash of mis-positioned hero before GSAP runs.
          opacity: ready ? 1 : 0,
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

"use client";

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { prefersReducedMotion, readHandoff } from "@/lib/transition";

interface DetailContentFadeProps {
  slug: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Fades in elements tagged with `data-detail-fade` inside its subtree on
 * mount. Pairs with the GSAP hero FLIP in BugDetailHero: hero swoops first,
 * tagged content settles in after with a tiny upward drift.
 *
 * Only runs the fade when a FLIP handoff is present (user clicked through
 * from the grid). For deep links, refreshes, and reduced-motion users, the
 * content renders in place — no fade at all. This avoids the "blackout"
 * pattern Axel diagnosed where autoAlpha:0 → 1 with useEffect ran AFTER
 * first paint, briefly killing all visible content.
 */
export default function DetailContentFade({
  slug,
  className,
  children,
}: DetailContentFadeProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // useLayoutEffect runs synchronously after DOM commit but before browser
  // paint, so we can hide the fade targets in the FLIP-with-handoff case
  // BEFORE the browser commits the first frame. Non-FLIP paths leave the
  // content visible from first paint.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (prefersReducedMotion()) return;

    const hasHandoff = readHandoff(slug) !== null;
    if (!hasHandoff) return; // deep-link / refresh: no fade, content visible immediately

    const fadeTargets = node.querySelectorAll("[data-detail-fade]");
    if (fadeTargets.length === 0) return;

    // Synchronously hide pre-paint, then animate in after the hero lands.
    gsap.set(fadeTargets, { autoAlpha: 0, y: 14 });
    const tween = gsap.to(fadeTargets, {
      autoAlpha: 1,
      y: 0,
      duration: 0.55,
      ease: "power2.out",
      stagger: 0.06,
      delay: 0.35, // wait for hero FLIP to land
    });

    return () => {
      tween.kill();
    };
  }, [slug]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
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
 * Renders as a flex column so it can directly replace the surrounding
 * layout container; that keeps the gap-8 rhythm of the detail page intact.
 * No-ops under reduced motion. If a handoff is present we delay slightly so
 * the content reveals just after the hero lands.
 */
export default function DetailContentFade({
  slug,
  className,
  children,
}: DetailContentFadeProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (prefersReducedMotion()) return;

    const fadeTargets = node.querySelectorAll("[data-detail-fade]");
    if (fadeTargets.length === 0) return;
    const hasHandoff = readHandoff(slug) !== null;
    // After a click-through from the grid, delay so the hero lands first.
    const delay = hasHandoff ? 0.35 : 0;

    gsap.fromTo(
      fadeTargets,
      { autoAlpha: 0, y: 14 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.55,
        ease: "power2.out",
        stagger: 0.06,
        delay,
      },
    );
  }, [slug]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

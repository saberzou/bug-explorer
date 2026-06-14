"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { consumeViewFade, prefersReducedMotion } from "@/lib/transition";

/**
 * Fades the view in from black on arrival — but only when navigated here via
 * the Cabinet/Atlas toggle (which sets the one-shot fade flag). Deep links and
 * refreshes render immediately with no overlay.
 */
export default function ViewReveal() {
  const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    if (!consumeViewFade()) return;
    const ov = overlay.current;
    if (!ov) return;
    gsap.set(ov, { autoAlpha: 1 });
    gsap.to(ov, { autoAlpha: 0, duration: 0.5, ease: "power2.out" });
  }, []);
  return (
    <div
      ref={overlay}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 bg-[#0e0d0b] opacity-0"
    />
  );
}

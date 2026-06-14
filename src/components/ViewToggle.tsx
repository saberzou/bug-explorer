"use client";

import { useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import gsap from "gsap";
import { prefersReducedMotion, setViewFade } from "@/lib/transition";

/**
 * Two-state switch between the grid ("Cabinet") and the globe ("Atlas").
 * Navigating fades the screen to black, then the destination view fades back
 * in from black (see ViewReveal) for a smooth cross-view transition.
 */
export default function ViewToggle() {
  const pathname = usePathname();
  const router = useRouter();
  const overlay = useRef<HTMLDivElement>(null);
  const onAtlas = pathname?.startsWith("/atlas");

  const go = (href: string) => (e: React.MouseEvent) => {
    const here = href === "/atlas" ? onAtlas : !onAtlas;
    if (here) {
      e.preventDefault();
      return;
    }
    if (prefersReducedMotion()) return; // let the link navigate normally
    e.preventDefault();
    setViewFade();
    const ov = overlay.current;
    if (!ov) {
      router.push(href);
      return;
    }
    gsap.to(ov, {
      autoAlpha: 1,
      duration: 0.28,
      ease: "power2.in",
      onComplete: () => router.push(href),
    });
  };

  const base =
    "rounded-full px-5 py-2 text-[11px] uppercase tracking-[0.25em] transition-colors";
  const active = "text-amber-100";
  const idle = "text-zinc-500 hover:text-zinc-300";

  return (
    <>
      <nav className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/30 p-1.5 ring-1 ring-zinc-700/40 backdrop-blur-sm">
        <a href="/" onClick={go("/")} className={`${base} ${onAtlas ? idle : active}`}>
          Cabinet
        </a>
        <a href="/atlas" onClick={go("/atlas")} className={`${base} ${onAtlas ? active : idle}`}>
          Atlas
        </a>
      </nav>
      <div
        ref={overlay}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-50 bg-[#0e0d0b] opacity-0"
      />
    </>
  );
}

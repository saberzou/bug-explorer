"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Small two-state switch between the grid ("Cabinet") and the globe ("Atlas").
 * Matches the site's small-caps, amber-on-near-black header language.
 */
export default function ViewToggle() {
  const pathname = usePathname();
  const onAtlas = pathname?.startsWith("/atlas");

  const base =
    "px-3 py-1 text-[10px] uppercase tracking-[0.25em] transition-colors";
  const active = "text-amber-100";
  const idle = "text-zinc-500 hover:text-zinc-300";

  return (
    <nav className="pointer-events-auto flex items-center gap-1 rounded-full bg-black/30 p-1 ring-1 ring-zinc-700/40 backdrop-blur-sm">
      <Link href="/" className={`${base} ${onAtlas ? idle : active}`}>
        Cabinet
      </Link>
      <Link href="/atlas" className={`${base} ${onAtlas ? active : idle}`}>
        Atlas
      </Link>
    </nav>
  );
}

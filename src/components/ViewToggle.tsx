"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Two-state switch between the grid ("Cabinet") and the globe ("Atlas"). */
export default function ViewToggle() {
  const pathname = usePathname();
  const onAtlas = pathname?.startsWith("/atlas");
  const onLab = pathname?.startsWith("/lab");
  const onCabinet = !onAtlas && !onLab;

  const base =
    "rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.2em] transition-colors";
  const active = "text-amber-100";
  const idle = "text-zinc-500 hover:text-zinc-300";

  return (
    <nav className="pointer-events-auto flex items-center gap-1 rounded-full bg-black/30 p-1.5 ring-1 ring-zinc-700/40 backdrop-blur-sm">
      <Link href="/" className={`${base} ${onCabinet ? active : idle}`}>
        Cabinet
      </Link>
      <Link href="/atlas" className={`${base} ${onAtlas ? active : idle}`}>
        Atlas
      </Link>
      <Link href="/lab" className={`${base} ${onLab ? active : idle}`}>
        Lab
      </Link>
    </nav>
  );
}

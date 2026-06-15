"use client";

import dynamic from "next/dynamic";
import ViewToggle from "@/components/ViewToggle";
import type { AtlasPin } from "@/components/AtlasGlobe";

// three.js is heavy — load the globe only on the client, only on this route,
// so the home grid bundle stays light.
const AtlasGlobe = dynamic(() => import("@/components/AtlasGlobe"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center">
      <div className="h-56 w-56 animate-pulse rounded-full bg-zinc-800/60 ring-1 ring-zinc-700/40" />
    </div>
  ),
});

export default function AtlasView({ pins, count }: { pins: AtlasPin[]; count: number }) {
  return (
    <main className="relative h-dvh w-dvw overflow-hidden bg-[#0e0d0b] text-zinc-100">
      <AtlasGlobe pins={pins} />

      <header className="pointer-events-none absolute left-0 top-0 z-10 flex w-full flex-col items-center gap-1 bg-gradient-to-b from-[#0e0d0b] via-[#0e0d0b]/70 to-transparent p-4 pb-12 text-center sm:p-6">
        <h1 className="font-serif text-2xl text-amber-100 sm:text-3xl">Bug Explorer</h1>
        <p className="text-xs text-zinc-400">
          {count} specimens · drag to spin · pinch to zoom · tap to inspect
        </p>
      </header>

      <footer className="pointer-events-none absolute bottom-0 left-0 z-10 flex w-full flex-col items-center gap-3 bg-gradient-to-t from-[#0e0d0b] via-[#0e0d0b]/70 to-transparent pb-5 pt-12">
        <ViewToggle />
        <p className="text-[10px] uppercase tracking-widest text-zinc-600">
          the field atlas · {new Date().getUTCFullYear()}
        </p>
      </footer>
    </main>
  );
}

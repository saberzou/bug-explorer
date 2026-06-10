import HexGridSkeleton from "@/components/HexGridSkeleton";

/**
 * Route-level loading UI for the home page. Renders while the static page
 * is being prepared during client-side navigation (e.g. returning to /
 * from a bug detail page). Mirrors the dark background and centered cluster
 * layout so the swap to the live grid is visually continuous.
 */
export default function HomeLoading() {
  return (
    <main className="relative h-dvh w-dvw overflow-hidden bg-[#0e0d0b] text-zinc-100">
      <HexGridSkeleton />
      <header className="pointer-events-none absolute left-0 top-0 z-10 w-full bg-gradient-to-b from-[#0e0d0b] via-[#0e0d0b]/85 to-transparent p-4 pb-10 text-center sm:p-6 sm:pb-12">
        <div className="flex flex-col items-center gap-1">
          <div className="h-7 w-40 animate-pulse rounded-md bg-zinc-800/70" />
          <div className="mt-2 h-3 w-56 animate-pulse rounded-full bg-zinc-800/50" />
        </div>
      </header>
    </main>
  );
}

import BugGrid from "@/components/BugGrid";
import { loadBugs } from "@/lib/bugs";

export default async function Home() {
  const bugs = await loadBugs();
  const sortedByDate = [...bugs].sort((a, b) =>
    b.discoveredOn.localeCompare(a.discoveredOn),
  );
  const latestSlug = sortedByDate[0]?.slug ?? null;

  return (
    <main className="relative h-dvh w-dvw overflow-hidden bg-[#0e0d0b] text-zinc-100">
      <BugGrid bugs={bugs} latestSlug={latestSlug} />
      <header className="pointer-events-none absolute left-0 top-0 z-10 w-full p-4 sm:p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-serif italic tracking-wide text-amber-100/90">
            Bug Explorer
          </h1>
          <p className="text-xs text-zinc-400">
            {bugs.length} specimens · drag to roam · tap to inspect
          </p>
        </div>
      </header>
      <footer className="pointer-events-none absolute bottom-3 right-4 z-10 text-[10px] uppercase tracking-widest text-zinc-600">
        a curio cabinet · {new Date().getUTCFullYear()}
      </footer>
    </main>
  );
}

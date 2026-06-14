import BugGrid from "@/components/BugGrid";
import ViewToggle from "@/components/ViewToggle";
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
      <header className="pointer-events-none absolute left-0 top-0 z-10 w-full bg-gradient-to-b from-[#0e0d0b] via-[#0e0d0b]/85 to-transparent p-4 pb-10 text-center sm:p-6 sm:pb-12">
        <div className="flex flex-col items-center gap-3">
          <h1 className="font-serif text-2xl text-amber-100 sm:text-3xl">
            Bug Explorer
          </h1>
          <p className="text-xs text-zinc-400">
            {bugs.length} specimens · drag to roam · tap to inspect
          </p>
          <ViewToggle />
        </div>
      </header>
      <footer className="pointer-events-none absolute bottom-0 left-0 z-10 w-full bg-gradient-to-t from-[#0e0d0b] via-[#0e0d0b]/70 to-transparent pb-3 pt-10 text-center text-[10px] uppercase tracking-widest text-zinc-600">
        a curio cabinet · {new Date().getUTCFullYear()}
      </footer>
    </main>
  );
}

/**
 * Skeleton placeholder for the bug detail route. Used as `loading.tsx` for
 * /bug/[slug] while the static page resolves (notably during client-side
 * navigation between bugs). Mirrors the layout of `bug/[slug]/page.tsx`:
 * back-link, circular hero on the left, headline + facts on the right,
 * then a 2-up photo grid below.
 *
 * Pure server-component-friendly CSS — Tailwind's animate-pulse, no JS.
 */
export default function BugDetailSkeleton() {
  return (
    <main className="min-h-dvh bg-[#0e0d0b] text-zinc-100" aria-busy="true">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10 sm:py-16">
        {/* back link placeholder */}
        <div className="h-3 w-24 animate-pulse rounded-full bg-zinc-800/80" />

        <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
          {/* circular hero */}
          <div className="aspect-square w-full max-w-xs flex-none animate-pulse rounded-full bg-zinc-900 ring-1 ring-zinc-800/60" />

          <div className="flex flex-1 flex-col gap-4">
            {/* rarity strip */}
            <div className="h-2 w-16 animate-pulse rounded-full bg-zinc-800/80" />
            {/* common name */}
            <div className="h-7 w-3/4 animate-pulse rounded-md bg-zinc-800/80" />
            {/* latin name */}
            <div className="h-4 w-1/2 animate-pulse rounded-md bg-zinc-800/60" />

            {/* dl grid */}
            <div className="mt-2 grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="h-2 w-14 animate-pulse rounded-full bg-zinc-800/60" />
                <div className="h-4 w-24 animate-pulse rounded-md bg-zinc-800/80" />
              </div>
              <div className="space-y-2">
                <div className="h-2 w-14 animate-pulse rounded-full bg-zinc-800/60" />
                <div className="h-4 w-20 animate-pulse rounded-md bg-zinc-800/80" />
              </div>
              <div className="col-span-2 space-y-2">
                <div className="h-2 w-14 animate-pulse rounded-full bg-zinc-800/60" />
                <div className="h-4 w-3/5 animate-pulse rounded-md bg-zinc-800/80" />
              </div>
            </div>

            {/* weird fact */}
            <div className="space-y-2 pt-2">
              <div className="h-2 w-20 animate-pulse rounded-full bg-zinc-800/60" />
              <div className="h-4 w-full animate-pulse rounded-md bg-zinc-800/80" />
              <div className="h-4 w-5/6 animate-pulse rounded-md bg-zinc-800/70" />
              <div className="h-4 w-2/3 animate-pulse rounded-md bg-zinc-800/60" />
            </div>

            {/* why it's cool */}
            <div className="space-y-2 pt-2">
              <div className="h-2 w-24 animate-pulse rounded-full bg-zinc-800/60" />
              <div className="h-4 w-full animate-pulse rounded-md bg-zinc-800/80" />
              <div className="h-4 w-4/5 animate-pulse rounded-md bg-zinc-800/70" />
            </div>
          </div>
        </div>

        {/* photo grid */}
        <div className="flex flex-col gap-3">
          <div className="h-2 w-24 animate-pulse rounded-full bg-zinc-800/60" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="flex flex-col gap-2 overflow-hidden rounded-lg bg-zinc-900/60 ring-1 ring-zinc-800/60"
              >
                <div className="aspect-[4/3] w-full animate-pulse bg-zinc-800/80" />
                <div className="space-y-2 px-3 pb-3">
                  <div className="h-2 w-3/4 animate-pulse rounded-full bg-zinc-800/60" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

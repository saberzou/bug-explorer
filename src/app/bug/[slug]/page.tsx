import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import BugImage from "@/components/BugImage";
import { getBug, loadBugs } from "@/lib/bugs";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const bugs = await loadBugs();
  return bugs.map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const bug = await getBug(slug);
  if (!bug) return { title: "Unknown Specimen — Bug Explorer" };
  return {
    title: `${bug.commonName} (${bug.latinName}) — Bug Explorer`,
    description: bug.weirdFact,
    openGraph: {
      title: `${bug.commonName} — Bug Explorer`,
      description: bug.weirdFact,
      images: [{ url: `/bugs/${bug.slug}.png` }],
    },
  };
}

const RARITY_BADGE: Record<string, string> = {
  common: "text-zinc-400",
  uncommon: "text-emerald-300",
  rare: "text-sky-300",
  legendary: "text-amber-300",
};

export default async function BugPage({ params }: PageProps) {
  const { slug } = await params;
  const bug = await getBug(slug);
  if (!bug) notFound();

  return (
    <main className="min-h-dvh bg-[#0e0d0b] text-zinc-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10 sm:py-16">
        <Link
          href="/"
          className="self-start text-xs uppercase tracking-widest text-zinc-400 hover:text-amber-200"
        >
          ← back to grid
        </Link>

        <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
          <div className="aspect-square w-full max-w-xs flex-none overflow-hidden rounded-full bg-zinc-900 ring-1 ring-zinc-700/50">
            <BugImage
              src={`/bugs/${bug.slug}.png`}
              alt={bug.commonName}
              className="h-full w-full object-cover"
              fallbackText="image pending"
            />
          </div>

          <div className="flex flex-1 flex-col gap-4">
            <header>
              <p
                className={`text-[10px] uppercase tracking-[0.3em] ${RARITY_BADGE[bug.rarity] ?? "text-zinc-400"}`}
              >
                {bug.rarity}
              </p>
              <h1 className="mt-1 font-serif text-3xl text-amber-100">
                {bug.commonName}
              </h1>
              <p className="mt-1 font-serif italic text-zinc-400">
                {bug.latinName}
              </p>
            </header>

            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-zinc-500">
                  Habitat
                </dt>
                <dd className="mt-1 text-zinc-200">{bug.habitat}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-zinc-500">
                  Size
                </dt>
                <dd className="mt-1 text-zinc-200">{bug.sizeMm} mm</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[10px] uppercase tracking-widest text-zinc-500">
                  Discovered
                </dt>
                <dd className="mt-1 text-zinc-200">{bug.discoveredOn}</dd>
              </div>
            </dl>

            <section>
              <h2 className="text-[10px] uppercase tracking-widest text-zinc-500">
                Weird but real
              </h2>
              <p className="mt-2 text-base leading-relaxed text-zinc-100">
                {bug.weirdFact}
              </p>
            </section>

            <section>
              <h2 className="text-[10px] uppercase tracking-widest text-zinc-500">
                Why it&apos;s cool
              </h2>
              <p className="mt-2 text-base italic leading-relaxed text-amber-100/90">
                {bug.whyItsCool}
              </p>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

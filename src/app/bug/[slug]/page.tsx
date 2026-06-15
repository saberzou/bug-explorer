import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BugDetailHero from "@/components/BugDetailHero";
import BugBackLink from "@/components/BugBackLink";
import BugPhotos from "@/components/BugPhotos";
import DetailContentFade from "@/components/DetailContentFade";
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
      <DetailContentFade
        slug={bug.slug}
        className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10 sm:py-16"
      >
        <BugBackLink />

        <div
          data-detail-fade-row
          className="flex flex-col items-center gap-8 sm:flex-row sm:items-start"
        >
          <BugDetailHero
            slug={bug.slug}
            commonName={bug.commonName}
            fallbackBg={bug.colorPalette?.[0]}
          />

          <div className="flex flex-1 flex-col gap-4">
            <header data-detail-fade>
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

            <dl data-detail-fade className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-zinc-500">
                  Habitat
                </dt>
                <dd className="mt-1 text-zinc-200">{bug.habitat}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-zinc-500">
                  {bug.sizeKind === "wingspan" ? "Wingspan" : "Body length"}
                </dt>
                <dd className="mt-1 text-zinc-200">{bug.sizeMm} mm</dd>
              </div>
              {bug.order && (
                <div className="col-span-2">
                  <dt className="text-[10px] uppercase tracking-widest text-zinc-500">
                    Order
                  </dt>
                  <dd className="mt-1 text-zinc-200">
                    {bug.order}
                    {bug.family ? ` · ${bug.family}` : ""}
                  </dd>
                </div>
              )}
            </dl>

            <section data-detail-fade>
              <h2 className="text-[10px] uppercase tracking-widest text-zinc-500">
                Weird but real
              </h2>
              <p className="mt-2 text-base leading-relaxed text-zinc-100">
                {bug.weirdFact}
              </p>
            </section>

            <section data-detail-fade>
              <h2 className="text-[10px] uppercase tracking-widest text-zinc-500">
                Why it&apos;s cool
              </h2>
              <p className="mt-2 text-base italic leading-relaxed text-amber-100/90">
                {bug.whyItsCool}
              </p>
            </section>
          </div>
        </div>

        {bug.photos && bug.photos.length > 0 && (
          <div data-detail-fade>
            <BugPhotos photos={bug.photos} commonName={bug.commonName} />
          </div>
        )}
      </DetailContentFade>
    </main>
  );
}

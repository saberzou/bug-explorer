"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import ViewToggle from "@/components/ViewToggle";
import { prefersReducedMotion } from "@/lib/transition";
import type { Rarity } from "@/lib/types";

export interface LabBug {
  slug: string;
  commonName: string;
  rarity: Rarity;
}

type Phase = "idle" | "breeding" | "done" | "error";

interface Result {
  image: string;
  name: string;
  parents: [string, string];
}

export default function LabView({ bugs }: { bugs: LabBug[] }) {
  const bySlug = useRef(new Map(bugs.map((b) => [b.slug, b])));
  const [parents, setParents] = useState<(string | null)[]>([null, null]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string>("");

  const vesselRef = useRef<HTMLDivElement>(null);
  const slotRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const ghostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const both = parents[0] && parents[1];

  function addParent(slug: string) {
    setParents((p) => {
      if (p.includes(slug)) return p;
      if (!p[0]) return [slug, p[1]];
      if (!p[1]) return [p[0], slug];
      return p;
    });
  }
  function removeParent(i: number) {
    if (phase === "breeding") return;
    setParents((p) => (i === 0 ? [null, p[1]] : [p[0], null]));
  }

  // --- curved carousel: arc each item by its distance from the row center -----
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      const sl = el.scrollLeft;
      const half = el.clientWidth / 2 || 1;
      for (const child of Array.from(el.children) as HTMLElement[]) {
        // Use static offsetLeft (no per-frame getBoundingClientRect) so iOS
        // momentum scroll doesn't jitter the arc.
        const c = child.offsetLeft + child.offsetWidth / 2 - sl;
        const dx = (c - half) / half; // -1..1 across the viewport
        child.style.transform = `translateY(${16 * dx * dx}px)`;
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
    };
  }, [phase]);

  // Direction-aware: vertical drag picks a bug up; horizontal swipe scrolls the
  // carousel (touch-action: pan-x); a tap adds it to the next slot.
  function startDrag(e: React.PointerEvent, slug: string) {
    if (phase === "breeding") return;
    const startX = e.clientX;
    const startY = e.clientY;
    let mode: "" | "drag" | "scroll" = "";
    const ghost = ghostRef.current;
    if (ghost) {
      ghost.style.backgroundImage = `url(/bugs/${slug}.png)`;
      ghost.style.left = `${startX}px`;
      ghost.style.top = `${startY}px`;
    }
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!mode) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) mode = "drag";
        else if (Math.abs(dx) > 10) {
          mode = "scroll"; // let the browser scroll the carousel
          cleanup();
          return;
        } else return;
      }
      if (mode === "drag" && ghost) {
        ev.preventDefault();
        ghost.style.opacity = "1";
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
      }
    };
    const up = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (ghost) ghost.style.opacity = "0";
      if (mode === "drag") {
        const v = vesselRef.current?.getBoundingClientRect();
        const over =
          v && ev.clientX >= v.left && ev.clientX <= v.right && ev.clientY >= v.top && ev.clientY <= v.bottom;
        if (over) addParent(slug);
      } else if (mode === "" && Math.hypot(dx, dy) < 8) {
        addParent(slug); // tap
      }
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
  }

  async function breed() {
    if (!both || phase === "breeding") return;
    setPhase("breeding");
    setError("");
    const reduced = prefersReducedMotion();
    if (!reduced) {
      slotRefs.forEach((r, i) => {
        const el = r.current;
        if (!el) return;
        gsap.to(el, {
          x: 0,
          y: 0,
          rotate: i === 0 ? 200 : -200,
          scale: 0.4,
          opacity: 0.15,
          duration: 0.9,
          ease: "power2.inOut",
        });
      });
    }
    const minAnim = reduced ? Promise.resolve() : new Promise((res) => setTimeout(res, 900));
    try {
      const reqP = fetch("/api/breed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a: parents[0], b: parents[1] }),
      });
      const [res] = await Promise.all([reqP, minAnim]);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail ? `${data.error} [${data.detail}]` : data?.error || "Something went wrong.");
      }
      setResult(data as Result);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("error");
    }
  }

  function reset() {
    setParents([null, null]);
    setResult(null);
    setError("");
    setPhase("idle");
    slotRefs.forEach((r) => r.current && gsap.set(r.current, { clearProps: "all" }));
  }

  function save() {
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.image;
    a.download = `${result.name.toLowerCase().replace(/\s+/g, "-")}.png`;
    a.click();
  }

  return (
    <main className="relative flex h-dvh w-dvw flex-col overflow-hidden bg-[#0e0d0b] text-zinc-100">
      <header className="pointer-events-none z-10 flex flex-col items-center gap-1 px-4 pt-5 text-center">
        <h1 className="font-serif text-2xl text-amber-100 sm:text-3xl">Breeding Lab</h1>
        <p className="text-xs text-zinc-400">tap or drag two specimens into the dish, then breed</p>
      </header>

      {/* dish + action, grouped so the button hugs the dish */}
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6">
        <div
          ref={vesselRef}
          className="relative grid aspect-square w-full max-w-[256px] place-items-center rounded-full"
          style={{
            background:
              "radial-gradient(circle at 35% 30%, rgba(255,240,200,0.10), rgba(20,18,14,0.6) 70%)",
            boxShadow: "inset 0 0 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(251,191,36,0.18)",
          }}
        >
          {phase !== "done" && (
            <>
              <ParentSlot ref={slotRefs[0]} bug={parents[0] ? bySlug.current.get(parents[0]) : undefined} side="left" onRemove={() => removeParent(0)} />
              <ParentSlot ref={slotRefs[1]} bug={parents[1] ? bySlug.current.get(parents[1]) : undefined} side="right" onRemove={() => removeParent(1)} />
            </>
          )}
          {phase === "breeding" && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="h-14 w-14 animate-spin rounded-full border-2 border-amber-200/30 border-t-amber-200" />
              <p className="absolute bottom-7 text-[11px] uppercase tracking-widest text-amber-200/80">splicing genes…</p>
            </div>
          )}
          {phase === "done" && result && (
            <div className="absolute inset-2 grid place-items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.image} alt={result.name} className="h-full w-full animate-[fadein_0.6s_ease] rounded-full object-cover" />
            </div>
          )}
        </div>

        {/* action area, close under the dish */}
        {phase === "done" && result ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <div>
              <p className="font-serif text-xl text-amber-100">{result.name}</p>
              <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                {result.parents[0]} × {result.parents[1]}
              </p>
              <p className="mt-1 text-[11px] text-zinc-500">Not saved — download it or it&apos;s lost to science.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={save} className="rounded-full bg-amber-200/90 px-5 py-2 text-[12px] font-medium uppercase tracking-wider text-[#1a1408] hover:bg-amber-200">
                Save image
              </button>
              <button onClick={reset} className="rounded-full px-5 py-2 text-[12px] uppercase tracking-wider text-zinc-300 ring-1 ring-zinc-700 hover:text-amber-100">
                Breed again
              </button>
            </div>
          </div>
        ) : phase === "error" ? (
          <div className="flex flex-col items-center gap-3">
            <p className="max-w-[300px] text-center text-[11px] text-rose-300">{error}</p>
            <button onClick={() => setPhase("idle")} className="rounded-full px-5 py-2 text-[12px] uppercase tracking-wider text-zinc-300 ring-1 ring-zinc-700 hover:text-amber-100">
              Try again
            </button>
          </div>
        ) : (
          <button
            onClick={breed}
            disabled={!both || phase === "breeding"}
            className="rounded-full bg-amber-200/90 px-6 py-2.5 text-[12px] font-medium uppercase tracking-widest text-[#1a1408] transition-opacity disabled:cursor-not-allowed disabled:opacity-25"
          >
            {phase === "breeding" ? "Breeding…" : both ? "Breed" : "Pick two"}
          </button>
        )}
      </div>

      {/* curved, scrollable, fading carousel */}
      {phase !== "done" && (
        <div
          ref={scrollRef}
          className="lab-carousel flex h-28 shrink-0 items-center gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain"
          style={{
            touchAction: "pan-x",
            paddingLeft: "42vw",
            paddingRight: "42vw",
            WebkitMaskImage:
              "linear-gradient(to right, transparent, #000 16%, #000 84%, transparent)",
            maskImage: "linear-gradient(to right, transparent, #000 16%, #000 84%, transparent)",
          }}
        >
          {bugs.map((b) => {
            const chosen = parents.includes(b.slug);
            return (
              <button
                key={b.slug}
                onPointerDown={(e) => startDrag(e, b.slug)}
                aria-label={`Add ${b.commonName}`}
                style={{ touchAction: "pan-x", willChange: "transform" }}
                className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-zinc-900 ring-1 transition ${
                  chosen ? "opacity-30 ring-amber-300/60" : "ring-zinc-700/50"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/bugs/${b.slug}.png`} alt={b.commonName} draggable={false} className="h-full w-full object-cover" />
              </button>
            );
          })}
        </div>
      )}

      {/* nav — matched to the other pages: toggle + caption, bottom-centered */}
      <footer className="z-10 flex flex-col items-center gap-3 pb-5 pt-3">
        <ViewToggle />
        <p className="text-[10px] uppercase tracking-widest text-zinc-600">
          the breeding lab · {new Date().getUTCFullYear()}
        </p>
      </footer>

      <div
        ref={ghostRef}
        className="pointer-events-none fixed z-50 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cover bg-center opacity-0 ring-2 ring-amber-200/60"
        style={{ left: 0, top: 0 }}
      />

      <style>{`
        @keyframes fadein { from { opacity: 0; transform: scale(0.7) } to { opacity: 1; transform: scale(1) } }
        .lab-carousel::-webkit-scrollbar { display: none }
        .lab-carousel { scrollbar-width: none }
      `}</style>
    </main>
  );
}

const SIDE_POS = {
  left: "left-[15%] top-1/2 -translate-y-1/2",
  right: "right-[15%] top-1/2 -translate-y-1/2",
} as const;

function ParentSlot({
  bug,
  side,
  onRemove,
  ref,
}: {
  bug?: LabBug;
  side: "left" | "right";
  onRemove: () => void;
  ref: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={ref} className={`absolute ${SIDE_POS[side]}`}>
      {bug ? (
        <button
          onClick={onRemove}
          aria-label={`Remove ${bug.commonName}`}
          className="group relative h-20 w-20 overflow-hidden rounded-full bg-zinc-900 ring-2 ring-amber-200/40"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/bugs/${bug.slug}.png`} alt={bug.commonName} className="h-full w-full object-cover" />
          <span className="absolute inset-0 grid place-items-center bg-black/0 text-lg text-transparent group-hover:bg-black/40 group-hover:text-amber-100">✕</span>
        </button>
      ) : (
        <div className="grid h-20 w-20 place-items-center rounded-full border border-dashed border-zinc-600/60 text-[10px] uppercase tracking-wider text-zinc-600">
          {side}
        </div>
      )}
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
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

  const both = parents[0] && parents[1];

  function addParent(slug: string) {
    setParents((p) => {
      if (p.includes(slug)) return p;
      if (!p[0]) return [slug, p[1]];
      if (!p[1]) return [p[0], slug];
      return p; // both full
    });
  }
  function removeParent(i: number) {
    if (phase === "breeding") return;
    setParents((p) => (i === 0 ? [null, p[1]] : [p[0], null]));
  }

  // Pointer drag from the tray into the vessel (with tap fallback).
  function startDrag(e: React.PointerEvent, slug: string) {
    if (phase === "breeding") return;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const ghost = ghostRef.current;
    const bug = bySlug.current.get(slug);
    if (ghost && bug) {
      ghost.style.backgroundImage = `url(/bugs/${slug}.png)`;
      ghost.style.left = `${startX}px`;
      ghost.style.top = `${startY}px`;
    }
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) moved = true;
      if (moved && ghost) {
        ghost.style.opacity = "1";
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
      }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (ghost) ghost.style.opacity = "0";
      const v = vesselRef.current?.getBoundingClientRect();
      const overVessel =
        v && ev.clientX >= v.left && ev.clientX <= v.right && ev.clientY >= v.top && ev.clientY <= v.bottom;
      if (!moved || overVessel) addParent(slug); // tap, or dropped on the vessel
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  async function breed() {
    if (!both || phase === "breeding") return;
    setPhase("breeding");
    setError("");
    const reduced = prefersReducedMotion();

    // merge animation: parent discs swirl to center
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
      if (!res.ok) throw new Error(data?.error || "Something went wrong.");
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
        <p className="text-xs text-zinc-400">drag two specimens into the dish · cross-breed a new one</p>
      </header>

      {/* the dish */}
      <div className="relative flex flex-1 items-center justify-center px-6">
        <div
          ref={vesselRef}
          className="relative grid aspect-square w-full max-w-[340px] place-items-center rounded-full"
          style={{
            background:
              "radial-gradient(circle at 35% 30%, rgba(255,240,200,0.10), rgba(20,18,14,0.6) 70%)",
            boxShadow: "inset 0 0 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(251,191,36,0.18)",
          }}
        >
          {/* parent slots (idle / breeding) */}
          {phase !== "done" && (
            <>
              <ParentSlot
                ref={slotRefs[0]}
                bug={parents[0] ? bySlug.current.get(parents[0]) : undefined}
                side="left"
                onRemove={() => removeParent(0)}
              />
              <ParentSlot
                ref={slotRefs[1]}
                bug={parents[1] ? bySlug.current.get(parents[1]) : undefined}
                side="right"
                onRemove={() => removeParent(1)}
              />
            </>
          )}

          {phase === "breeding" && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="h-16 w-16 animate-spin rounded-full border-2 border-amber-200/30 border-t-amber-200" />
              <p className="absolute bottom-8 text-[11px] uppercase tracking-widest text-amber-200/80">
                splicing genes…
              </p>
            </div>
          )}

          {phase === "done" && result && (
            <div className="absolute inset-2 grid place-items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.image}
                alt={result.name}
                className="h-full w-full animate-[fadein_0.6s_ease] rounded-full object-cover"
              />
            </div>
          )}

          {phase === "error" && (
            <p className="absolute bottom-6 left-0 right-0 px-6 text-center text-[11px] text-rose-300">
              {error}
            </p>
          )}
        </div>
      </div>

      {/* result caption + actions, or the breed button */}
      <div className="z-10 flex flex-col items-center gap-3 px-4">
        {phase === "done" && result ? (
          <>
            <div className="text-center">
              <p className="font-serif text-xl text-amber-100">{result.name}</p>
              <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                {result.parents[0]} × {result.parents[1]}
              </p>
              <p className="mt-1 text-[11px] text-zinc-500">
                Not saved — download it or it&apos;s lost to science.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={save}
                className="rounded-full bg-amber-200/90 px-5 py-2 text-[12px] font-medium uppercase tracking-wider text-[#1a1408] hover:bg-amber-200"
              >
                Save image
              </button>
              <button
                onClick={reset}
                className="rounded-full px-5 py-2 text-[12px] uppercase tracking-wider text-zinc-300 ring-1 ring-zinc-700 hover:text-amber-100"
              >
                Breed again
              </button>
            </div>
          </>
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

      {/* species tray */}
      {phase !== "done" && (
        <div className="z-10 mt-3 shrink-0 overflow-x-auto px-3 pb-2">
          <div className="flex gap-2.5">
            {bugs.map((b) => {
              const chosen = parents.includes(b.slug);
              return (
                <button
                  key={b.slug}
                  onPointerDown={(e) => startDrag(e, b.slug)}
                  aria-label={`Add ${b.commonName}`}
                  className={`relative h-14 w-14 shrink-0 touch-none overflow-hidden rounded-full bg-zinc-900 ring-1 transition ${
                    chosen ? "opacity-30 ring-amber-300/60" : "ring-zinc-700/50"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/bugs/${b.slug}.png`}
                    alt={b.commonName}
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <footer className="z-10 flex flex-col items-center gap-3 pb-5 pt-3">
        <ViewToggle />
      </footer>

      {/* drag ghost */}
      <div
        ref={ghostRef}
        className="pointer-events-none fixed z-50 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cover bg-center opacity-0 ring-2 ring-amber-200/60"
        style={{ left: 0, top: 0 }}
      />

      <style>{`@keyframes fadein{from{opacity:0;transform:scale(0.7)}to{opacity:1;transform:scale(1)}}`}</style>
    </main>
  );
}

const SIDE_POS = {
  left: "left-[14%] top-1/2 -translate-y-1/2",
  right: "right-[14%] top-1/2 -translate-y-1/2",
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
          className="group relative h-24 w-24 overflow-hidden rounded-full bg-zinc-900 ring-2 ring-amber-200/40"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/bugs/${bug.slug}.png`} alt={bug.commonName} className="h-full w-full object-cover" />
          <span className="absolute inset-0 grid place-items-center bg-black/0 text-lg text-transparent group-hover:bg-black/40 group-hover:text-amber-100">
            ✕
          </span>
        </button>
      ) : (
        <div className="grid h-24 w-24 place-items-center rounded-full border border-dashed border-zinc-600/60 text-[10px] uppercase tracking-wider text-zinc-600">
          {side}
        </div>
      )}
    </div>
  );
}

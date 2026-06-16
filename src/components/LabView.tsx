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

// --- carousel geometry --------------------------------------------------------
// We do NOT use native scroll. A single rAF loop owns one horizontal offset and
// writes each item's x AND y transform in the same frame, so the horizontal
// position and the vertical arc can never desync (that cross-thread desync was
// the shake: native momentum scroll runs on the compositor while the JS arc
// update lagged a frame behind on the main thread).
const ITEM = 56; // px, the circular thumb (h-14 / w-14)
const GAP = 14; // px between thumbs
const STEP = ITEM + GAP; // center-to-center spacing
const ARC_DEPTH = 26; // px the edge items dip below center — smaller = subtler arc
const ARC_SPAN = 320; // px from center over which the full dip is reached
const TOP_PAD = 10;
const CAROUSEL_H = TOP_PAD + ITEM + ARC_DEPTH + 14; // sized so the dip never clips
const FRICTION = 0.94; // inertia decay per frame
const MIN_V = 0.02; // velocity floor to stop the loop

export default function LabView({ bugs }: { bugs: LabBug[] }) {
  const bySlug = useRef(new Map(bugs.map((b) => [b.slug, b])));
  const [parents, setParents] = useState<(string | null)[]>([null, null]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string>("");

  const vesselRef = useRef<HTMLDivElement>(null);
  const slotRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const ghostRef = useRef<HTMLDivElement>(null);

  // breeding swirl: the two parent images orbit + blur into a merging flash
  const swirlRefs = [useRef<HTMLImageElement>(null), useRef<HTMLImageElement>(null)];
  const flashRef = useRef<HTMLDivElement>(null);
  const swirlTl = useRef<gsap.core.Timeline | null>(null);

  // carousel refs (no React state in the hot path — all mutable refs)
  const viewportRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const offsetRef = useRef(0); // current scroll offset in px (0 = first item centered)
  const velRef = useRef(0); // px/frame inertia
  const targetRef = useRef<number | null>(null); // snap target, when settling
  const rafRef = useRef(0);
  const runningRef = useRef(false);
  const maxOffsetRef = useRef(0);

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

  // Paint one frame: place every item by transform from the single offset.
  // x and y are written together → impossible to desync → no shake.
  function paint() {
    const vp = viewportRef.current;
    if (!vp) return;
    const center = vp.clientWidth / 2;
    const off = offsetRef.current;
    const items = itemRefs.current;
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      if (!el) continue;
      const x = center - ITEM / 2 + i * STEP - off; // item's left in viewport px
      const dist = x + ITEM / 2 - center; // signed px from viewport center
      const t = Math.min(Math.abs(dist) / ARC_SPAN, 1);
      const y = TOP_PAD + ARC_DEPTH * t * t; // flat center, eased dip to the sides
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      // fade + shrink far items a touch so the row reads as a shelf, not a strip
      const f = 1 - 0.45 * t;
      el.style.opacity = String(f);
    }
  }

  function clampOffset(v: number) {
    const max = maxOffsetRef.current;
    if (v < 0) return 0;
    if (v > max) return max;
    return v;
  }

  function ensureLoop() {
    if (runningRef.current) return;
    runningRef.current = true;
    const tick = () => {
      const target = targetRef.current;
      if (target !== null) {
        // ease toward snap target
        const d = target - offsetRef.current;
        offsetRef.current += d * 0.18;
        if (Math.abs(d) < 0.5) {
          offsetRef.current = target;
          targetRef.current = null;
          velRef.current = 0;
          paint();
          runningRef.current = false;
          return;
        }
      } else {
        // inertia
        offsetRef.current += velRef.current * 16;
        const clamped = clampOffset(offsetRef.current);
        if (clamped !== offsetRef.current) {
          offsetRef.current = clamped;
          velRef.current = 0;
        }
        velRef.current *= FRICTION;
        if (Math.abs(velRef.current) < MIN_V) {
          velRef.current = 0;
          // settle to nearest item center
          targetRef.current = clampOffset(Math.round(offsetRef.current / STEP) * STEP);
        }
      }
      paint();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  // measure + initial paint; recompute bounds on resize / list change
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const measure = () => {
      maxOffsetRef.current = Math.max(0, (bugs.length - 1) * STEP);
      offsetRef.current = clampOffset(offsetRef.current);
      paint();
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(rafRef.current);
      runningRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, bugs.length]);

  // Unified pointer handler. Horizontal drag scrolls the track (we own it, no
  // native scroll). Vertical drag lifts a ghost to drop into the dish. A tap
  // adds the bug. Velocity from the last moves drives inertia on release.
  function onItemPointerDown(e: React.PointerEvent, slug: string) {
    if (phase === "breeding") return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startOffset = offsetRef.current;
    let mode: "" | "scroll" | "drag" = "";
    let lastX = startX;
    let lastT = performance.now();
    const ghost = ghostRef.current;

    // stop any running inertia/snap the moment a finger lands
    targetRef.current = null;
    velRef.current = 0;

    if (ghost) {
      ghost.style.backgroundImage = `url(/bugs/${slug}.png)`;
      ghost.style.left = `${startX}px`;
      ghost.style.top = `${startY}px`;
    }

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!mode) {
        if (Math.abs(dx) > 8 && Math.abs(dx) >= Math.abs(dy)) mode = "scroll";
        else if (Math.abs(dy) > 10) mode = "drag";
        else return;
      }
      if (mode === "scroll") {
        ev.preventDefault();
        offsetRef.current = clampOffset(startOffset - dx);
        const now = performance.now();
        const dt = now - lastT || 16;
        velRef.current = -(ev.clientX - lastX) / dt; // px/ms
        lastX = ev.clientX;
        lastT = now;
        paint();
      } else if (mode === "drag" && ghost) {
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
      } else if (mode === "scroll") {
        ensureLoop(); // fling with inertia + snap
      } else if (Math.hypot(dx, dy) < 8) {
        addParent(slug); // tap
      }
      cleanup();
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  async function breed() {
    if (!both || phase === "breeding") return;
    setPhase("breeding");
    setError("");
    const reduced = prefersReducedMotion();
    // Start the swirl after React mounts the breeding <img>s.
    if (!reduced) requestAnimationFrame(() => requestAnimationFrame(() => startSwirl()));
    const minAnim = reduced ? Promise.resolve() : new Promise((res) => setTimeout(res, 1700));
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
      stopSwirl();
      setResult(data as Result);
      setPhase("done");
    } catch (e) {
      stopSwirl();
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("error");
    }
  }

  // Two parent images orbit the dish center, spin, and blur as they pull inward;
  // a soft flash swells between them — reads as genes being spliced. The loop
  // repeats until stopSwirl() (API resolved), so it covers any request length.
  function startSwirl() {
    const a = swirlRefs[0].current;
    const b = swirlRefs[1].current;
    const flash = flashRef.current;
    if (!a || !b) return;
    swirlTl.current?.kill();

    // proxy the timeline tweens; onUpdate maps it onto the two orbiting images
    const o = { ang: 0, rad: 46, blur: 0, spin: 0 };
    const place = () => {
      const set = (el: HTMLImageElement, ph: number) => {
        const x = Math.cos(o.ang + ph) * o.rad;
        const y = Math.sin(o.ang + ph) * o.rad;
        const sc = 0.74 + (1 - o.rad / 46) * 0.18;
        el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${o.spin}deg) scale(${sc})`;
        el.style.filter = `blur(${o.blur}px)`;
      };
      set(a, 0);
      set(b, Math.PI); // 180° apart so they chase each other
    };
    gsap.set([a, b], { opacity: 1 });
    if (flash) gsap.set(flash, { opacity: 0, scale: 0.3, xPercent: -50, yPercent: -50 });
    place();

    const tl = gsap.timeline({ repeat: -1, onUpdate: place });
    // each cycle: swing the pair around ~1.5 turns while tightening + blurring,
    // then ease back out so it can loop seamlessly until the result lands.
    tl.to(o, { ang: Math.PI * 3, spin: 360, rad: 16, blur: 3, duration: 1.5, ease: "power1.inOut" })
      .to(o, { ang: Math.PI * 4.5, spin: 540, rad: 46, blur: 0, duration: 1.2, ease: "power1.inOut" });
    if (flash) {
      tl.to(flash, { opacity: 0.85, scale: 1, duration: 0.5, ease: "power2.out" }, 1.1)
        .to(flash, { opacity: 0, scale: 0.4, duration: 0.5, ease: "power2.in" }, 1.7);
    }
    swirlTl.current = tl;
  }

  function stopSwirl() {
    swirlTl.current?.kill();
    swirlTl.current = null;
  }

  function reset() {
    stopSwirl();
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
          {phase !== "done" && phase !== "breeding" && (
            <>
              <ParentSlot ref={slotRefs[0]} bug={parents[0] ? bySlug.current.get(parents[0]) : undefined} side="left" onRemove={() => removeParent(0)} />
              <ParentSlot ref={slotRefs[1]} bug={parents[1] ? bySlug.current.get(parents[1]) : undefined} side="right" onRemove={() => removeParent(1)} />
            </>
          )}
          {phase === "breeding" && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              {/* soft merge flash that swells between the two specimens */}
              <div
                ref={flashRef}
                className="absolute left-1/2 top-1/2 h-24 w-24 rounded-full"
                style={{
                  background:
                    "radial-gradient(circle, rgba(255,244,214,0.95), rgba(251,191,36,0.45) 45%, rgba(251,191,36,0) 72%)",
                  opacity: 0,
                  mixBlendMode: "screen",
                }}
              />
              {/* the two parents, driven by the swirl timeline (GSAP sets transform) */}
              {parents[0] && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  ref={swirlRefs[0]}
                  src={`/bugs/${parents[0]}.png`}
                  alt=""
                  className="absolute left-1/2 top-1/2 h-20 w-20 rounded-full object-cover ring-2 ring-amber-200/40"
                  style={{ willChange: "transform, filter" }}
                />
              )}
              {parents[1] && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  ref={swirlRefs[1]}
                  src={`/bugs/${parents[1]}.png`}
                  alt=""
                  className="absolute left-1/2 top-1/2 h-20 w-20 rounded-full object-cover ring-2 ring-amber-200/40"
                  style={{ willChange: "transform, filter" }}
                />
              )}
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

      {/* curved carousel — JS-owned transform track (no native scroll) */}
      {phase !== "done" && (
        <div
          ref={viewportRef}
          className="relative w-full shrink-0 overflow-hidden"
          style={{
            height: CAROUSEL_H,
            touchAction: "none",
            WebkitMaskImage:
              "linear-gradient(to right, transparent, #000 18%, #000 82%, transparent)",
            maskImage: "linear-gradient(to right, transparent, #000 18%, #000 82%, transparent)",
          }}
        >
          {bugs.map((b, i) => {
            const chosen = parents.includes(b.slug);
            return (
              <button
                key={b.slug}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                onPointerDown={(e) => onItemPointerDown(e, b.slug)}
                aria-label={`Add ${b.commonName}`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: ITEM,
                  height: ITEM,
                  touchAction: "none",
                  willChange: "transform, opacity",
                  transform: "translate3d(0,0,0)",
                }}
                className={`overflow-hidden rounded-full bg-zinc-900 ring-1 ${
                  chosen ? "ring-amber-300/70" : "ring-zinc-700/50"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/bugs/${b.slug}.png`}
                  alt={b.commonName}
                  draggable={false}
                  className={`h-full w-full object-cover transition-opacity ${chosen ? "opacity-40" : ""}`}
                />
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
